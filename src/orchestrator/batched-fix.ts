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

    const merged = await mergeAndRecord(
      options.repoPath, batchResult.keptBranches, touchedFiles,
    );
    allKeptBranches.push(...merged);

    remaining = deferred;
  }

  return { remaining, batchNum };
}

/**
 * Run fixes in file-disjoint batches with informed grouping.
 *
 * Two-phase execution prevents branch drift:
 *
 * **Phase 1 — Parallel only.** Build file-disjoint batches and run them
 * concurrently in worktrees. After each batch, squash-merge kept branches
 * and record touched files. Repeat until no more disjoint batches can be
 * formed. No serial fallback occurs in this phase.
 *
 * **Phase 2 — Serial + parallel.** Process remaining clusters (which all
 * conflict with previously touched files). Allows serial fallback so
 * clusters run one-at-a-time. After each merge, re-checks for new
 * parallel opportunities.
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

  // Phase 2: serial fixes + new parallel opportunities
  if (afterParallel.length > 0) {
    log("info", "Parallel phase complete, starting serial phase", {
      parallelBatches: batchNum,
      remaining: afterParallel.length,
      touchedFiles: touchedFiles.size,
    });

    ({ remaining: afterParallel, batchNum } = await runBatchLoop(
      options, afterParallel, touchedFiles, allItems, allKeptBranches,
      concurrency, batchNum, true, progress, globalTotal,
    ));
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
