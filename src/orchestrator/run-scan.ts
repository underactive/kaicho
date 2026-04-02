import * as os from "node:os";
import * as path from "node:path";
import type { RunResult } from "../types/index.js";
import { resolveModel, getBase } from "../config/index.js";
import { SqliteStore } from "../suggestion-store/index.js";
import { buildSecurityScanPrompt, buildQaScanPrompt, buildDocsScanPrompt, buildContractsScanPrompt, buildStateScanPrompt, buildResourcesScanPrompt, buildTestingScanPrompt, buildDxScanPrompt, buildPerformanceScanPrompt, buildResilienceScanPrompt, buildLoggingScanPrompt, SCAN_TASKS } from "../prompts/index.js";
import { clusterSuggestions, type SuggestionCluster } from "../dedup/index.js";
import { resolveScope, buildFileManifest, type ScopeOptions } from "../scope/index.js";
import { fingerprint, formatRepoContext } from "../repo-context/index.js";
import { summarizeClusters, saveEnrichedCache } from "../summarizer/index.js";
import { log } from "../logger/index.js";
import { resolveAdapter, ALL_AGENT_NAMES } from "./resolve-adapter.js";

export interface ScanProgress {
  agent: string;
  status: "started" | "running" | "done" | "skipped";
  task?: string;
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
  retention?: number;
  summarizerModel?: string;
  onProgress?: (progress: ScanProgress) => void;
}

export interface MultiScanResult {
  results: RunResult[];
  clusters: SuggestionCluster[];
  totalSuggestions: number;
  totalDurationMs: number;
}

const TASK_PROMPTS: Record<string, (fileManifest?: string, repoContext?: string) => string> = {
  security: buildSecurityScanPrompt,
  qa: buildQaScanPrompt,
  docs: buildDocsScanPrompt,
  contracts: buildContractsScanPrompt,
  state: buildStateScanPrompt,
  resources: buildResourcesScanPrompt,
  testing: buildTestingScanPrompt,
  dx: buildDxScanPrompt,
  performance: buildPerformanceScanPrompt,
  resilience: buildResilienceScanPrompt,
  logging: buildLoggingScanPrompt,
};

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

  // Heartbeat every 30s so UIs know the agent is still alive
  const scanStart = Date.now();
  const heartbeat = onProgress
    ? setInterval(() => {
        onProgress({ agent, status: "running", durationMs: Date.now() - scanStart });
      }, 30_000)
    : undefined;

  const result = await adapter.run(absRepoPath, prompt);

  if (heartbeat) clearInterval(heartbeat);

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

  // Fingerprint the repo for prompt context (graceful degradation on failure)
  let repoContextString: string | undefined;
  try {
    const ctx = await fingerprint(absRepoPath);
    repoContextString = formatRepoContext(ctx) || undefined;
    if (repoContextString) {
      log("info", "Repo context detected", {
        languages: ctx.languages.map((s) => s.name),
        frameworks: ctx.frameworks.map((s) => s.name),
      });
    }
  } catch (err) {
    log("warn", "Repo context failed, continuing without", { error: String(err) });
  }

  const prompt = buildPrompt(fileManifest, repoContextString);

  // Agent selection: --agents (list) > all, then apply --exclude
  let agentsToRun: string[];
  if (options.agents && options.agents.length > 0) {
    agentsToRun = options.agents;
  } else {
    agentsToRun = ALL_AGENT_NAMES;
  }

  if (options.exclude && options.exclude.length > 0) {
    const excludeSet = new Set(options.exclude);
    agentsToRun = agentsToRun.filter((a) =>
      !excludeSet.has(a) && !excludeSet.has(getBase(a)),
    );
  }

  const startMs = Date.now();

  // Group agents by base CLI command so same-CLI variants run sequentially
  // (avoids file-lock races, e.g. two Cursor instances writing cli-config.json).
  // Different CLI groups still run in parallel.
  const groups = new Map<string, string[]>();
  for (const a of agentsToRun) {
    const base = getBase(a);
    const group = groups.get(base) ?? [];
    group.push(a);
    groups.set(base, group);
  }

  const runGroup = async (agents: string[]): Promise<RunResult[]> => {
    const groupResults: RunResult[] = [];
    for (const a of agents) {
      groupResults.push(
        await runSingleAgent(a, prompt, absRepoPath, timeoutMs, resolveModel(a, options.models), options.onProgress),
      );
    }
    return groupResults;
  };

  const settled = await Promise.allSettled(
    [...groups.values()].map((group) => runGroup(group)),
  );

  const results: RunResult[] = settled.flatMap((s) => {
    if (s.status === "fulfilled") return s.value;
    // Promise.allSettled rejection — should not happen since adapters never throw
    return [{
      agent: "unknown",
      status: "agent-error" as const,
      suggestions: [],
      rawOutput: "",
      rawError: String(s.reason),
      durationMs: Date.now() - startMs,
      startedAt: new Date().toISOString(),
      error: `Unexpected rejection: ${String(s.reason)}`,
    }];
  });

  // Save each result
  const store = new SqliteStore(absRepoPath);
  try {
    for (const result of results) {
      if (result.status === "skipped") continue;
      try {
        store.save(result, task, absRepoPath);
      } catch (err) {
        log("error", "Failed to save run result", { agent: result.agent, error: String(err) });
      }
    }
  } finally {
    store.close();
  }

  const clusters = clusterSuggestions(results);

  // Auto-enrich with Ollama summaries (no-op if Ollama not running)
  const enriched = await summarizeClusters(clusters, {
    model: options.summarizerModel,
  });
  if (enriched > 0) {
    await saveEnrichedCache(absRepoPath, clusters, task);
  }

  const totalSuggestions = results.reduce((sum, r) => sum + r.suggestions.length, 0);
  const totalDurationMs = Date.now() - startMs;

  return { results, clusters, totalSuggestions, totalDurationMs };
}
