import type { SuggestionCluster } from "../dedup/index.js";
import {
  runParallelFix,
  type ParallelFixOptions,
  type ParallelFixResult,
  type ParallelFixItemResult,
  type ParallelFixProgress,
  type ParallelFixConfirmResult,
  type ParallelFixItemAction,
  type ParallelFixRetryAction,
} from "./run-parallel-fix.js";
import { mergeBranch, getChangedFiles, getCurrentBranch } from "../branch/index.js";
import { log } from "../logger/index.js";

// Re-export types that callers need
export type {
  ParallelFixItemResult,
  ParallelFixProgress,
  ParallelFixConfirmResult,
  ParallelFixItemAction,
  ParallelFixRetryAction,
};

export interface BatchedFixOptions {
  repoPath: string;
  clusters: SuggestionCluster[];
  agent?: string;
  timeoutMs?: number;
  models?: Record<string, string>;
  scanModels?: Record<string, string>;
  concurrency?: number;
  auto?: boolean;
  verbose?: boolean;
  validate?: boolean;
  reviewer?: string;
  onProgress?: (progress: ParallelFixProgress) => void;
  onConfirm?: ParallelFixOptions["onConfirm"];
}

export interface BatchedFixResult {
  items: ParallelFixItemResult[];
  keptBranches: string[];
  totalApplied: number;
  totalSkipped: number;
  totalFailed: number;
  totalKept: number;
  totalDiscarded: number;
  totalDurationMs: number;
}

/**
 * Build the next file-disjoint batch from remaining clusters.
 * Respects both intra-batch file conflicts and files touched by prior batches.
 */
function buildBatch(
  remaining: SuggestionCluster[],
  touchedFiles: Set<string>,
  concurrency: number,
): { batch: SuggestionCluster[]; deferred: SuggestionCluster[] } {
  const batch: SuggestionCluster[] = [];
  const batchFiles = new Set<string>();
  const deferred: SuggestionCluster[] = [];

  for (const cluster of remaining) {
    if (batch.length >= concurrency) {
      deferred.push(cluster);
      continue;
    }

    if (!batchFiles.has(cluster.file) && !touchedFiles.has(cluster.file)) {
      batch.push(cluster);
      batchFiles.add(cluster.file);
    } else {
      deferred.push(cluster);
    }
  }

  // Serial fallback: all remaining share files with touchedFiles
  if (batch.length === 0 && deferred.length > 0) {
    batch.push(deferred.shift()!);
  }

  return { batch, deferred };
}

/**
 * Merge kept branches into the current branch and record which files were touched.
 * Returns the successfully merged branch names.
 */
async function mergeAndRecord(
  repoPath: string,
  branches: string[],
  touchedFiles: Set<string>,
): Promise<string[]> {
  const merged: string[] = [];

  for (const branch of branches) {
    try {
      await mergeBranch(repoPath, branch);

      // Informed grouping: discover actual files touched by this merge
      const changed = await getChangedFiles(repoPath, "HEAD~1");
      for (const file of changed) {
        touchedFiles.add(file);
      }

      merged.push(branch);
    } catch (err) {
      log("warn", "Failed to merge fix branch, skipping", {
        branch,
        error: String(err),
      });
    }
  }

  return merged;
}

/**
 * Run fixes in file-disjoint batches with informed grouping.
 *
 * Groups clusters so no two in the same batch touch the same file,
 * runs each batch in parallel (using worktrees), then merges kept
 * branches before starting the next batch. After each merge, the
 * actual files changed are recorded so subsequent batches avoid
 * files modified by earlier fixes.
 */
export async function runBatchedFix(options: BatchedFixOptions): Promise<BatchedFixResult> {
  const concurrency = options.concurrency ?? 3;
  const startMs = Date.now();
  const touchedFiles = new Set<string>();
  const allItems: ParallelFixItemResult[] = [];
  const allKeptBranches: string[] = [];
  let remaining = [...options.clusters];
  let batchNum = 0;

  while (remaining.length > 0) {
    batchNum++;
    const { batch, deferred } = buildBatch(remaining, touchedFiles, concurrency);

    if (batch.length === 0) break;

    log("info", "Running fix batch", {
      batch: batchNum,
      size: batch.length,
      remaining: deferred.length,
      touchedFiles: touchedFiles.size,
    });

    // Run this batch with existing parallel worktree infra
    const batchResult: ParallelFixResult = await runParallelFix({
      repoPath: options.repoPath,
      clusters: batch,
      agent: options.agent,
      timeoutMs: options.timeoutMs,
      models: options.models,
      scanModels: options.scanModels,
      concurrency,
      auto: options.auto,
      verbose: options.verbose,
      validate: options.validate,
      reviewer: options.reviewer,
      onProgress: options.onProgress,
      onConfirm: options.onConfirm,
    });

    allItems.push(...batchResult.items);

    // Merge kept branches into current branch, recording touched files
    const merged = await mergeAndRecord(
      options.repoPath, batchResult.keptBranches, touchedFiles,
    );
    allKeptBranches.push(...merged);

    remaining = deferred;
  }

  return {
    items: allItems,
    keptBranches: allKeptBranches,
    totalApplied: allItems.filter((i) => i.status === "applied").length,
    totalSkipped: allItems.filter((i) => i.status === "skipped" || i.status === "no-changes").length,
    totalFailed: allItems.filter((i) => i.status === "agent-error").length,
    totalKept: allKeptBranches.length,
    totalDiscarded: allItems.filter((i) => i.status === "applied").length - allKeptBranches.length,
    totalDurationMs: Date.now() - startMs,
  };
}
