import * as os from "node:os";
import * as path from "node:path";
import type { AgentAdapter } from "../types/index.js";
import {
  ClaudeAdapter,
  CodexAdapter,
  CursorAdapter,
  GeminiAdapter,
} from "../agent-adapters/index.js";
import { AGENT_CONFIGS } from "../config/index.js";
import type { SuggestionCluster } from "../dedup/index.js";
import { buildFixPrompt } from "../prompts/index.js";
import { buildCommitMessage } from "./commit-message.js";
import {
  ensureCleanWorkTree,
  createFixBranch,
  captureDiff,
  commitFix,
  discardFixBranch,
  keepFixBranch,
} from "../branch/index.js";
import { recordFix } from "../fix-log/index.js";
import { log } from "../logger/index.js";

export interface BatchFixItemResult {
  clusterId: string;
  file: string;
  agent: string;
  status: "applied" | "no-changes" | "agent-error" | "skipped";
  filesChanged: number;
  durationMs: number;
  diff: string;
  error?: string;
}

export interface BatchFixResult {
  branch: string;
  previousBranch: string;
  items: BatchFixItemResult[];
  totalApplied: number;
  totalSkipped: number;
  totalFailed: number;
  totalDurationMs: number;
}

export interface BatchFixProgress {
  current: number;
  total: number;
  clusterId: string;
  file: string;
  step: "starting" | "running-agent" | "applied" | "no-changes" | "failed" | "skipped" | "conflict" | "batch-done";
  agent?: string;
  filesChanged?: number;
  error?: string;
}

export type BatchFixAction = "continue" | "skip" | "stop";

export interface BatchFixOptions {
  repoPath: string;
  clusters: SuggestionCluster[];
  agent?: string;
  timeoutMs?: number;
  models?: Record<string, string>;
  auto?: boolean;
  onProgress?: (progress: BatchFixProgress) => void;
  onConfirm?: (
    item: BatchFixItemResult,
    cluster: SuggestionCluster,
    current: number,
    total: number,
  ) => Promise<BatchFixAction>;
}

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

function pickAgent(cluster: SuggestionCluster, override?: string): string {
  if (override) return override;
  return cluster.agents[0] ?? "claude";
}

export async function runBatchFix(options: BatchFixOptions): Promise<BatchFixResult> {
  const { clusters, timeoutMs, auto } = options;
  const expanded = options.repoPath.startsWith("~")
    ? path.join(os.homedir(), options.repoPath.slice(1))
    : options.repoPath;
  const absRepoPath = path.resolve(expanded);
  const notify = options.onProgress ?? (() => {});
  const startMs = Date.now();

  // Check for clean working tree
  await ensureCleanWorkTree(absRepoPath);

  // One branch for the entire batch
  const { branch, previousBranch } = await createFixBranch(absRepoPath);

  const items: BatchFixItemResult[] = [];
  let totalApplied = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const modifiedFiles = new Set<string>();

  try {
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i]!

      // Conflict detection: skip if this cluster's file was already modified
      if (modifiedFiles.has(cluster.file)) {
        const item: BatchFixItemResult = {
          clusterId: cluster.id,
          file: cluster.file,
          agent: pickAgent(cluster, options.agent),
          status: "skipped",
          filesChanged: 0,
          durationMs: 0,
          diff: "",
          error: `Conflict: ${cluster.file} was already modified by a previous fix`,
        };
        items.push(item);
        totalSkipped++;
        notify({ current: i + 1, total: clusters.length, clusterId: cluster.id, file: cluster.file, step: "conflict", error: item.error });
        continue;
      };
      const agentName = pickAgent(cluster, options.agent);
      const fixStartMs = Date.now();

      notify({
        current: i + 1,
        total: clusters.length,
        clusterId: cluster.id,
        file: cluster.file,
        step: "starting",
        agent: agentName,
      });

      const adapter = resolveAdapter(agentName, timeoutMs, options.models?.[agentName]);
      const available = await adapter.isAvailable();

      if (!available) {
        const item: BatchFixItemResult = {
          clusterId: cluster.id,
          file: cluster.file,
          agent: agentName,
          status: "agent-error",
          filesChanged: 0,
          durationMs: Date.now() - fixStartMs,
          diff: "",
          error: `Agent "${agentName}" not installed`,
        };
        items.push(item);
        totalFailed++;
        notify({ current: i + 1, total: clusters.length, clusterId: cluster.id, file: cluster.file, step: "failed", error: item.error });
        continue;
      }

      notify({
        current: i + 1,
        total: clusters.length,
        clusterId: cluster.id,
        file: cluster.file,
        step: "running-agent",
        agent: agentName,
      });

      const prompt = buildFixPrompt(cluster);
      log("info", "Batch fix", { agent: agentName, cluster: `${cluster.file}:${cluster.line}`, index: i + 1, total: clusters.length });

      const result = await adapter.run(absRepoPath, prompt, "fix");

      if (result.status !== "success") {
        const item: BatchFixItemResult = {
          clusterId: cluster.id,
          file: cluster.file,
          agent: agentName,
          status: "agent-error",
          filesChanged: 0,
          durationMs: Date.now() - fixStartMs,
          diff: "",
          error: result.error ?? result.status,
        };
        items.push(item);
        totalFailed++;
        notify({ current: i + 1, total: clusters.length, clusterId: cluster.id, file: cluster.file, step: "failed", error: item.error });
        continue;
      }

      const { diff, filesChanged } = await captureDiff(absRepoPath, previousBranch);

      if (filesChanged === 0) {
        const item: BatchFixItemResult = {
          clusterId: cluster.id,
          file: cluster.file,
          agent: agentName,
          status: "no-changes",
          filesChanged: 0,
          durationMs: Date.now() - fixStartMs,
          diff: "",
        };
        items.push(item);
        totalSkipped++;
        notify({ current: i + 1, total: clusters.length, clusterId: cluster.id, file: cluster.file, step: "no-changes" });
        continue;
      }

      // Commit this individual fix
      await commitFix(absRepoPath, buildCommitMessage(cluster, agentName));

      const item: BatchFixItemResult = {
        clusterId: cluster.id,
        file: cluster.file,
        agent: agentName,
        status: "applied",
        filesChanged,
        durationMs: Date.now() - fixStartMs,
        diff,
      };
      items.push(item);
      totalApplied++;
      modifiedFiles.add(cluster.file);

      await recordFix(absRepoPath, {
        clusterId: cluster.id,
        file: cluster.file,
        agent: agentName,
        branch,
        fixedAt: new Date().toISOString(),
      });

      notify({
        current: i + 1,
        total: clusters.length,
        clusterId: cluster.id,
        file: cluster.file,
        step: "applied",
        agent: agentName,
        filesChanged,
      });

      // Confirmation loop (unless --auto)
      if (!auto && options.onConfirm) {
        const action = await options.onConfirm(item, cluster, i + 1, clusters.length);
        if (action === "stop") break;
        // "skip" doesn't make sense after applying — it's already committed.
        // "continue" proceeds to next.
      }
    }

    notify({
      current: clusters.length,
      total: clusters.length,
      clusterId: "",
      file: "",
      step: "batch-done",
    });

  } catch (err) {
    log("error", "Batch fix error", { error: String(err) });
    // Don't discard — keep whatever was applied
  }

  return {
    branch,
    previousBranch,
    items,
    totalApplied,
    totalSkipped,
    totalFailed,
    totalDurationMs: Date.now() - startMs,
  };
}
