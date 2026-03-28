import * as os from "node:os";
import * as path from "node:path";
import type { SuggestionCluster } from "../dedup/index.js";
import { buildFixPrompt, extractFixerContext } from "../prompts/index.js";
import { resolveAdapter } from "./resolve-adapter.js";
import { executeRetry } from "./batch-fix-retry.js";
import { buildCommitMessage } from "./commit-message.js";
import {
  ensureCleanWorkTree,
  createFixBranch,
  captureDiff,
  commitFix,
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
  /** Set when this result is from a retry — suppresses further retry options */
  retryOf?: string;
  /** Fixer agent's decision context (approach, alternatives, tradeoffs) */
  fixerContext?: string;
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
  summary?: string;
}

export type BatchFixAction = "continue" | "skip" | "stop";

export interface BatchFixRetryAction {
  action: "retry";
  reviewer: string;
  concern: string;
}

export type BatchFixConfirmResult = BatchFixAction | BatchFixRetryAction;

export interface BatchFixOptions {
  repoPath: string;
  clusters: SuggestionCluster[];
  agent?: string;
  timeoutMs?: number;
  models?: Record<string, string>;
  auto?: boolean;
  verbose?: boolean;
  onProgress?: (progress: BatchFixProgress) => void;
  onConfirm?: (
    item: BatchFixItemResult,
    cluster: SuggestionCluster,
    current: number,
    total: number,
  ) => Promise<BatchFixConfirmResult>;
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
        summary: cluster.summary ?? undefined,
      });

      const adapter = resolveAdapter(agentName, timeoutMs, options.models?.[agentName], options.verbose);
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
      await commitFix(absRepoPath, buildCommitMessage(cluster, agentName, options.models?.[agentName]));

      const item: BatchFixItemResult = {
        clusterId: cluster.id,
        file: cluster.file,
        agent: agentName,
        status: "applied",
        filesChanged,
        durationMs: Date.now() - fixStartMs,
        diff,
        fixerContext: extractFixerContext(result.rawOutput) ?? undefined,
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
        if (typeof action === "object" && action.action === "retry") {
          totalApplied--;
          modifiedFiles.delete(cluster.file);

          const retryAdapter = resolveAdapter(action.reviewer, timeoutMs, options.models?.[action.reviewer], options.verbose);
          const { item: retryItem, applied } = await executeRetry({
            reviewer: action.reviewer,
            concern: action.concern,
            adapter: retryAdapter,
            repoPath: absRepoPath,
            previousBranch,
            branch,
            cluster,
            originalAgent: agentName,
            originalDiff: item.diff,
            fixStartMs,
            index: i + 1,
            total: clusters.length,
            notify,
          });

          items[items.length - 1] = retryItem;
          if (applied) {
            totalApplied++;
            modifiedFiles.add(cluster.file);
          } else {
            if (retryItem.status === "agent-error") totalFailed++;
            else totalSkipped++;
            continue;
          }

          // Re-confirm after retry — no further retries (retryOf is set)
          if (options.onConfirm) {
            const retryAction = await options.onConfirm(retryItem, cluster, i + 1, clusters.length);
            if (retryAction === "stop") break;
          }
        }
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
