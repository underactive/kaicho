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
import { mergeBranch, abortMerge, getChangedFiles, getCurrentBranch } from "../branch/index.js";
import { runGroupedFix } from "./run-grouped-fix.js";
import { log } from "../logger/index.js";

const MAX_GROUP_SIZE = 10;

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
  fixLogPath?: string;
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
 *
 * When `allowSerial` is false, returns an empty batch if no file-disjoint
 * grouping is possible — the caller decides when to transition to serial.
 */
function buildBatch(
  remaining: SuggestionCluster[],
  touchedFiles: Set<string>,
  concurrency: number,
  allowSerial: boolean,
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

  // Serial fallback: only when caller permits (phase 2)
  if (batch.length === 0 && deferred.length > 0 && allowSerial) {
    batch.push(deferred.shift()!);
  }

  return { batch, deferred };
}

/**
 * Merge kept branches into the current branch and record which files were touched.
 * Returns the successfully merged branch names and the branches that failed.
 *
 * On merge conflict, aborts the merge to restore a clean working tree so
 * subsequent merges and batches are not blocked by leftover conflict state.
 */
async function mergeAndRecord(
  repoPath: string,
  branches: string[],
  touchedFiles: Set<string>,
): Promise<{ merged: string[]; failed: string[] }> {
  const merged: string[] = [];
  const failed: string[] = [];

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
      log("warn", "Failed to merge fix branch, deferring for retry", {
        branch,
        error: String(err),
      });
      await abortMerge(repoPath);
      failed.push(branch);
    }
  }

  return { merged, failed };
}

/**
 * Run a sequence of batches, returning the batch counter for continuity.
 * Shared logic for both parallel-only and serial-allowed phases.
 *
 * `progress.offset` tracks how many clusters have been dispatched across
 * all previous batches so per-batch counters can be remapped to global.
 */
async function runBatchLoop(
  options: BatchedFixOptions,
  remaining: SuggestionCluster[],
  touchedFiles: Set<string>,
  allItems: ParallelFixItemResult[],
  allKeptBranches: string[],
  concurrency: number,
  batchNum: number,
  allowSerial: boolean,
  progress: { offset: number },
  globalTotal: number,
): Promise<{ remaining: SuggestionCluster[]; batchNum: number }> {
  while (remaining.length > 0) {
    batchNum++;
    const { batch, deferred } = buildBatch(remaining, touchedFiles, concurrency, allowSerial);

    if (batch.length === 0) break;

    log("info", "Running fix batch", {
      batch: batchNum,
      phase: allowSerial ? "serial" : "parallel",
      size: batch.length,
      remaining: deferred.length,
      touchedFiles: touchedFiles.size,
    });

    // Wrap onProgress to remap batch-local counters to global position
    const currentOffset = progress.offset;
    const wrappedProgress: typeof options.onProgress = options.onProgress
      ? (p) => {
          if (p.step === "done") return; // suppress per-batch done
          options.onProgress!({
            ...p,
            current: currentOffset + p.current,
            total: globalTotal,
          });
        }
      : undefined;

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
      fixLogPath: options.fixLogPath,
      onProgress: wrappedProgress,
      onConfirm: options.onConfirm,
    });

    progress.offset += batch.length;
    allItems.push(...batchResult.items);

    const { merged, failed } = await mergeAndRecord(
      options.repoPath, batchResult.keptBranches, touchedFiles,
    );
    allKeptBranches.push(...merged);

    // Defer merge-conflicted clusters for retry in a later batch.
    // The stale branch is deleted; runParallelFix will create a fresh one
    // from the updated HEAD that includes the fixes that caused the conflict.
    if (failed.length > 0) {
      const failedSet = new Set(failed);
      const failedClusterIds = new Set(
        batchResult.items
          .filter((item) => failedSet.has(item.branch))
          .map((item) => item.clusterId),
      );
      const retryClusters = batch.filter((c) => failedClusterIds.has(c.id));
      deferred.push(...retryClusters);
      log("info", "Deferred merge-conflicted clusters for retry", {
        count: retryClusters.length,
        clusterIds: retryClusters.map((c) => c.id),
      });
    }

    remaining = deferred;
  }

  return { remaining, batchNum };
}

/**
 * Group remaining clusters by file for the serial phase.
 * Files with 2+ clusters become groups (capped at MAX_GROUP_SIZE).
 * Files with 1 cluster go to singles for standard serial processing.
 */
function buildSerialGroups(
  remaining: SuggestionCluster[],
): { groups: SuggestionCluster[][]; singles: SuggestionCluster[] } {
  const byFile = new Map<string, SuggestionCluster[]>();
  for (const c of remaining) {
    const arr = byFile.get(c.file) ?? [];
    arr.push(c);
    byFile.set(c.file, arr);
  }

  const groups: SuggestionCluster[][] = [];
  const singles: SuggestionCluster[] = [];

  for (const [, fileClusters] of byFile) {
    if (fileClusters.length === 1) {
      singles.push(fileClusters[0]!);
    } else {
      // Cap at MAX_GROUP_SIZE; overflow becomes additional groups
      for (let i = 0; i < fileClusters.length; i += MAX_GROUP_SIZE) {
        const chunk = fileClusters.slice(i, i + MAX_GROUP_SIZE);
        if (chunk.length === 1) {
          singles.push(chunk[0]!);
        } else {
          groups.push(chunk);
        }
      }
    }
  }

  return { groups, singles };
}

/**
 * Run fixes in file-disjoint batches with informed grouping.
 *
 * Three-phase execution prevents branch drift:
 *
 * **Phase 1 — Parallel only.** Build file-disjoint batches and run them
 * concurrently in worktrees. After each batch, squash-merge kept branches
 * and record touched files. Repeat until no more disjoint batches can be
 * formed. No serial fallback occurs in this phase.
 *
 * **Phase 2 — Grouped same-file fixes.** Clusters that share a file are
 * grouped and processed in a single agent session (one worktree, one prompt,
 * one merge). This avoids the per-cluster serial overhead.
 *
 * **Phase 3 — Serial singles.** Remaining single-cluster files are processed
 * one-at-a-time with the existing serial fallback.
 */
export async function runBatchedFix(options: BatchedFixOptions): Promise<BatchedFixResult> {
  const concurrency = options.concurrency ?? 3;
  const startMs = Date.now();
  const touchedFiles = new Set<string>();
  const allItems: ParallelFixItemResult[] = [];
  const allKeptBranches: string[] = [];
  let remaining = [...options.clusters];
  const globalTotal = options.clusters.length;
  const progress = { offset: 0 };

  // Phase 1: exhaust all file-disjoint parallel batches (no serial fallback)
  let { remaining: afterParallel, batchNum } = await runBatchLoop(
    options, remaining, touchedFiles, allItems, allKeptBranches,
    concurrency, 0, false, progress, globalTotal,
  );

  // Phase 2+3: grouped same-file fixes, then serial singles
  if (afterParallel.length > 0) {
    log("info", "Parallel phase complete, starting serial phase", {
      parallelBatches: batchNum,
      remaining: afterParallel.length,
      touchedFiles: touchedFiles.size,
    });

    const { groups, singles } = buildSerialGroups(afterParallel);

    // Phase 2: grouped same-file fixes
    for (const group of groups) {
      batchNum++;
      log("info", "Running grouped fix", {
        batch: batchNum,
        file: group[0]!.file,
        size: group.length,
        touchedFiles: touchedFiles.size,
      });

      const currentOffset = progress.offset;
      const wrappedProgress: typeof options.onProgress = options.onProgress
        ? (p) => {
            if (p.step === "done") return;
            options.onProgress!({
              ...p,
              current: currentOffset + p.current,
              total: globalTotal,
            });
          }
        : undefined;

      const groupResult = await runGroupedFix({
        repoPath: options.repoPath,
        clusters: group,
        agent: options.agent,
        timeoutMs: options.timeoutMs,
        models: options.models,
        scanModels: options.scanModels,
        auto: options.auto,
        verbose: options.verbose,
        validate: options.validate,
        reviewer: options.reviewer,
        fixLogPath: options.fixLogPath,
        onProgress: wrappedProgress,
        onConfirm: options.onConfirm,
      });

      progress.offset += group.length;
      allItems.push(...groupResult.items);

      const { merged, failed } = await mergeAndRecord(
        options.repoPath, groupResult.keptBranches, touchedFiles,
      );
      allKeptBranches.push(...merged);

      // On merge failure, re-queue as singles for individual serial processing
      if (failed.length > 0) {
        singles.push(...group);
      }
    }

    // Phase 3: serial singles + new parallel opportunities
    if (singles.length > 0) {
      ({ remaining: afterParallel, batchNum } = await runBatchLoop(
        options, singles, touchedFiles, allItems, allKeptBranches,
        concurrency, batchNum, true, progress, globalTotal,
      ));
    }
  }

  // Single final "done" event (per-batch "done" events are suppressed)
  if (globalTotal > 0) {
    options.onProgress?.({
      current: globalTotal,
      total: globalTotal,
      clusterId: "",
      file: "",
      step: "done",
    });
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
