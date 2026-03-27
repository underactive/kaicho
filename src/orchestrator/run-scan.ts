import * as os from "node:os";
import * as path from "node:path";
import type { AgentAdapter, RunResult } from "../types/index.js";
import {
  ClaudeAdapter,
  CodexAdapter,
  CursorAdapter,
  GeminiAdapter,
} from "../agent-adapters/index.js";
import { AGENT_CONFIGS } from "../config/index.js";
import { JsonStore } from "../suggestion-store/index.js";
import { buildSecurityScanPrompt, buildQaScanPrompt, buildDocsScanPrompt } from "../prompts/index.js";
import { clusterSuggestions, type SuggestionCluster } from "../dedup/index.js";
import { resolveScope, buildFileManifest, type ScopeOptions } from "../scope/index.js";
import { summarizeClusters, saveEnrichedCache } from "../summarizer/index.js";
import { log } from "../logger/index.js";

export interface ScanProgress {
  agent: string;
  status: "started" | "done" | "skipped";
  durationMs?: number;
  suggestions?: number;
  error?: string;
}

export interface ScanOptions {
  agents?: string[];
  exclude?: string[];
  task: string;
  repoPath: string;
  timeoutMs?: number;
  scope?: string;
  files?: string;
  models?: Record<string, string>;
  onProgress?: (progress: ScanProgress) => void;
}

export interface MultiScanResult {
  results: RunResult[];
  clusters: SuggestionCluster[];
  totalSuggestions: number;
  totalDurationMs: number;
}

const TASK_PROMPTS: Record<string, (fileManifest?: string) => string> = {
  security: buildSecurityScanPrompt,
  qa: buildQaScanPrompt,
  docs: buildDocsScanPrompt,
};

const ALL_AGENT_NAMES = Object.keys(AGENT_CONFIGS);

function resolveAdapter(agent: string, timeoutMs?: number, model?: string): AgentAdapter {
  const opts: Partial<import("../types/index.js").AgentConfig> = {};
  if (timeoutMs) opts.timeoutMs = timeoutMs;
  if (model) opts.model = model;
  const hasOpts = Object.keys(opts).length > 0 ? opts : undefined;

  switch (agent) {
    case "claude":
      return new ClaudeAdapter(hasOpts);
    case "codex":
      return new CodexAdapter(hasOpts);
    case "cursor":
      return new CursorAdapter(hasOpts);
    case "gemini":
      return new GeminiAdapter(hasOpts);
    default:
      throw new Error(
        `Unknown agent: ${agent}. Available: ${ALL_AGENT_NAMES.join(", ")}`,
      );
  }
}

/**
 * Run a single agent scan. Used internally and when --agent is specified.
 */
async function runSingleAgent(
  agent: string,
  prompt: string,
  absRepoPath: string,
  timeoutMs?: number,
  model?: string,
  onProgress?: (progress: ScanProgress) => void,
): Promise<RunResult> {
  const adapter = resolveAdapter(agent, timeoutMs, model);

  const available = await adapter.isAvailable();
  if (!available) {
    log("warn", "Agent not available, skipping", { agent });
    onProgress?.({ agent, status: "skipped" });
    return {
      agent,
      status: "skipped",
      suggestions: [],
      rawOutput: "",
      rawError: "",
      durationMs: 0,
      startedAt: new Date().toISOString(),
      error: `Agent "${agent}" CLI not found in PATH`,
    };
  }

  log("info", "Running scan", { agent, repoPath: absRepoPath });
  onProgress?.({ agent, status: "started" });

  const result = await adapter.run(absRepoPath, prompt);

  onProgress?.({
    agent,
    status: "done",
    durationMs: result.durationMs,
    suggestions: result.suggestions.length,
    error: result.status !== "success" ? (result.error ?? result.status) : undefined,
  });

  return result;
}

/**
 * Run a scan with selected agents.
 * - `agents` selects specific agents. Omit for all available.
 * - `exclude` removes agents from the list.
 */
export async function runScan(options: ScanOptions): Promise<MultiScanResult> {
  const { task, repoPath, timeoutMs } = options;
  const expanded = repoPath.startsWith("~")
    ? path.join(os.homedir(), repoPath.slice(1))
    : repoPath;
  const absRepoPath = path.resolve(expanded);

  const buildPrompt = TASK_PROMPTS[task];
  if (!buildPrompt) {
    return {
      results: [{
        agent: "all",
        status: "agent-error",
        suggestions: [],
        rawOutput: "",
        rawError: "",
        durationMs: 0,
        startedAt: new Date().toISOString(),
        error: `Unknown task: ${task}. Available: ${Object.keys(TASK_PROMPTS).join(", ")}`,
      }],
      clusters: [],
      totalSuggestions: 0,
      totalDurationMs: 0,
    };
  }

  // Resolve file scope
  const scopedFiles = await resolveScope(absRepoPath, {
    scope: options.scope,
    files: options.files,
  });
  const fileManifest = scopedFiles ? buildFileManifest(scopedFiles) : undefined;

  if (scopedFiles) {
    log("info", "Scoped scan", { fileCount: scopedFiles.length });
  }

  const prompt = buildPrompt(fileManifest);

  // Agent selection: --agents (list) > all, then apply --exclude
  let agentsToRun: string[];
  if (options.agents && options.agents.length > 0) {
    agentsToRun = options.agents;
  } else {
    agentsToRun = ALL_AGENT_NAMES;
  }

  if (options.exclude && options.exclude.length > 0) {
    const excludeSet = new Set(options.exclude);
    agentsToRun = agentsToRun.filter((a) => !excludeSet.has(a));
  }

  const startMs = Date.now();

  // Run all agents in parallel
  const settled = await Promise.allSettled(
    agentsToRun.map((a) => runSingleAgent(a, prompt, absRepoPath, timeoutMs, options.models?.[a], options.onProgress)),
  );

  const results: RunResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    // Promise.allSettled rejection — should not happen since adapters never throw
    return {
      agent: agentsToRun[i] ?? "unknown",
      status: "agent-error" as const,
      suggestions: [],
      rawOutput: "",
      rawError: String(s.reason),
      durationMs: Date.now() - startMs,
      startedAt: new Date().toISOString(),
      error: `Unexpected rejection: ${String(s.reason)}`,
    };
  });

  // Save each result
  const store = new JsonStore(absRepoPath);
  for (const result of results) {
    if (result.status === "skipped") continue;
    try {
      await store.save(result, task, absRepoPath);
    } catch (err) {
      log("error", "Failed to save run result", { agent: result.agent, error: String(err) });
    }
  }

  const clusters = clusterSuggestions(results);

  // Auto-enrich with Ollama summaries (no-op if Ollama not running)
  const enriched = await summarizeClusters(clusters);
  if (enriched > 0) {
    await saveEnrichedCache(absRepoPath, clusters, task);
  }

  const totalSuggestions = results.reduce((sum, r) => sum + r.suggestions.length, 0);
  const totalDurationMs = Date.now() - startMs;

  return { results, clusters, totalSuggestions, totalDurationMs };
}
