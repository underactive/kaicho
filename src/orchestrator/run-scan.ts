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
import { buildSecurityScanPrompt } from "../prompts/index.js";
import { clusterSuggestions, type SuggestionCluster } from "../dedup/index.js";
import { resolveScope, buildFileManifest, type ScopeOptions } from "../scope/index.js";
import { log } from "../logger/index.js";

export interface ScanOptions {
  agent?: string;
  task: string;
  repoPath: string;
  timeoutMs?: number;
  scope?: string;
  files?: string;
}

export interface MultiScanResult {
  results: RunResult[];
  clusters: SuggestionCluster[];
  totalSuggestions: number;
  totalDurationMs: number;
}

const TASK_PROMPTS: Record<string, (fileManifest?: string) => string> = {
  security: buildSecurityScanPrompt,
};

const ALL_AGENT_NAMES = Object.keys(AGENT_CONFIGS);

function resolveAdapter(agent: string, timeoutMs?: number): AgentAdapter {
  const opts = timeoutMs ? { timeoutMs } : undefined;
  switch (agent) {
    case "claude":
      return new ClaudeAdapter(opts);
    case "codex":
      return new CodexAdapter(opts);
    case "cursor":
      return new CursorAdapter(opts);
    case "gemini":
      return new GeminiAdapter(opts);
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
): Promise<RunResult> {
  const adapter = resolveAdapter(agent, timeoutMs);

  const available = await adapter.isAvailable();
  if (!available) {
    log("warn", "Agent not available, skipping", { agent });
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
  return adapter.run(absRepoPath, prompt);
}

/**
 * Run a scan with one or all agents.
 * - If `agent` is specified, runs only that agent (returns single-element array).
 * - If `agent` is omitted or "all", runs all available agents in parallel.
 */
export async function runScan(options: ScanOptions): Promise<MultiScanResult> {
  const { agent, task, repoPath, timeoutMs } = options;
  const expanded = repoPath.startsWith("~")
    ? path.join(os.homedir(), repoPath.slice(1))
    : repoPath;
  const absRepoPath = path.resolve(expanded);

  const buildPrompt = TASK_PROMPTS[task];
  if (!buildPrompt) {
    return {
      results: [{
        agent: agent ?? "all",
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
  const agentsToRun = agent && agent !== "all"
    ? [agent]
    : ALL_AGENT_NAMES;

  const startMs = Date.now();

  // Run all agents in parallel
  const settled = await Promise.allSettled(
    agentsToRun.map((a) => runSingleAgent(a, prompt, absRepoPath, timeoutMs)),
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
  const totalSuggestions = results.reduce((sum, r) => sum + r.suggestions.length, 0);
  const totalDurationMs = Date.now() - startMs;

  return { results, clusters, totalSuggestions, totalDurationMs };
}
