import * as path from "node:path";
import type { AgentAdapter, RunResult } from "../types/index.js";
import { CodexAdapter } from "../agent-adapters/index.js";
import { JsonStore } from "../suggestion-store/index.js";
import { buildSecurityScanPrompt } from "../prompts/index.js";
import { log } from "../logger/index.js";

export interface ScanOptions {
  agent: string;
  task: string;
  repoPath: string;
  timeoutMs?: number;
}

const TASK_PROMPTS: Record<string, () => string> = {
  security: buildSecurityScanPrompt,
};

function resolveAdapter(agent: string, timeoutMs?: number): AgentAdapter {
  switch (agent) {
    case "codex":
      return new CodexAdapter(timeoutMs ? { timeoutMs } : undefined);
    default:
      throw new Error(`Unknown agent: ${agent}. Available: codex`);
  }
}

export async function runScan(options: ScanOptions): Promise<RunResult> {
  const { agent, task, repoPath, timeoutMs } = options;
  const absRepoPath = path.resolve(repoPath);

  const adapter = resolveAdapter(agent, timeoutMs);

  const available = await adapter.isAvailable();
  if (!available) {
    log("warn", "Agent not available", { agent });
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

  const buildPrompt = TASK_PROMPTS[task];
  if (!buildPrompt) {
    return {
      agent,
      status: "agent-error",
      suggestions: [],
      rawOutput: "",
      rawError: "",
      durationMs: 0,
      startedAt: new Date().toISOString(),
      error: `Unknown task: ${task}. Available: ${Object.keys(TASK_PROMPTS).join(", ")}`,
    };
  }

  const prompt = buildPrompt();
  log("info", "Running scan", { agent, task, repoPath: absRepoPath });

  const result = await adapter.run(absRepoPath, prompt);

  const store = new JsonStore(absRepoPath);
  try {
    await store.save(result, task, absRepoPath);
  } catch (err) {
    log("error", "Failed to save run result", { error: String(err) });
  }

  return result;
}
