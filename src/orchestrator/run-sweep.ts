import * as os from "node:os";
import * as path from "node:path";
import { runScan, type MultiScanResult } from "./run-scan.js";
import { runBatchedFix, type BatchedFixResult } from "./batched-fix.js";
import {
  ensureCleanWorkTree,
  createSweepWorktree,
  removeFixWorktree,
  pruneStaleWorktrees,
  revertMergeCommit,
} from "../branch/index.js";
import { loadFixLog } from "../fix-log/index.js";
import { log } from "../logger/index.js";
import { writeSweepReport, writeSweepRegressions } from "./sweep-report.js";
import type { SuggestionCluster } from "../dedup/index.js";
import {
  SWEEP_LAYERS,
  DEFAULT_MAX_ROUNDS,
  countCriticalHigh,
  type SweepOptions,
  type SweepReport,
  type SweepRoundResult,
  type SweepLayerResult,
  type SweepRegression,
  type SweepRemaining,
  type SweepRegressionReport,
  type SweepLayer,
} from "./sweep-types.js";

/**
 * Scan all tasks in a layer and return merged clusters.
 */
async function scanLayer(
  layer: SweepLayer,
  absRepoPath: string,
  options: SweepOptions,
): Promise<{ clusters: SuggestionCluster[]; scanResults: MultiScanResult[] }> {
  const allClusters: SuggestionCluster[] = [];
  const scanResults: MultiScanResult[] = [];

  for (const task of layer.tasks) {
    const result = await runScan({
      agents: options.agents,
      exclude: options.exclude,
      task,
      repoPath: absRepoPath,
      timeoutMs: options.timeoutMs,
      models: options.scanModels ?? options.models,
    });
    scanResults.push(result);
    allClusters.push(...result.clusters);
  }

  return { clusters: allClusters, scanResults };
}

/**
 * Filter out already-fixed clusters.
 */
async function filterFixed(
  clusters: SuggestionCluster[],
  absRepoPath: string,
): Promise<SuggestionCluster[]> {
  const fixLog = await loadFixLog(absRepoPath);
  const fixedIds = new Set(fixLog.map((f) => f.clusterId));
  return clusters.filter((c) => !fixedIds.has(c.id));
}

/**
 * Revert merged branches by reverting merge commits in reverse order.
 */
async function revertMerges(
  absRepoPath: string,
  mergedBranches: string[],
): Promise<void> {
  for (let i = mergedBranches.length - 1; i >= 0; i--) {
    try {
      await revertMergeCommit(absRepoPath);
      log("info", "Reverted merge", { branch: mergedBranches[i] });
    } catch (err) {
      log("warn", "Failed to revert merge", {
        branch: mergedBranches[i],
        error: String(err),
      });
      break;
    }
  }
}

/**
 * Check if a layer's fixes caused regressions in a previous layer.
 * Compares critical/high count before and after.
 */
async function checkRegressions(
  absRepoPath: string,
  prevLayer: SweepLayer,
  prevCriticalHigh: number,
  options: SweepOptions,
): Promise<SweepRegression | null> {
  const { clusters } = await scanLayer(prevLayer, absRepoPath, options);
  const newCriticalHigh = countCriticalHigh(clusters);

  if (newCriticalHigh > prevCriticalHigh) {
    return {
      previousLayerTasks: [...prevLayer.tasks],
      newFindingCount: newCriticalHigh - prevCriticalHigh,
      revertedBranches: [], // filled by caller
      details: `Critical/high findings in ${prevLayer.tasks.join(", ")} went from ${prevCriticalHigh} to ${newCriticalHigh}`,
    };
  }

  return null;
}

/**
 * Execute a single layer: scan → fix → merge → regression check.
 */
async function executeLayer(
  round: number,
  layer: SweepLayer,
  layerIndex: number,
  sweepWorktreePath: string,
  absRepoPath: string,
  options: SweepOptions,
  prevLayer: SweepLayer | null,
  prevCriticalHigh: number,
): Promise<{ result: SweepLayerResult; criticalHigh: number }> {
  const startMs = Date.now();
  options.onLayerStart?.(round, layer);

  // 1. Scan (from worktree)
  const { clusters } = await scanLayer(layer, sweepWorktreePath, options);
  log("info", "Layer scan complete", {
    round,
    layer: layer.layer,
    tasks: layer.tasks,
    findings: clusters.length,
  });

  // 2. Filter already-fixed (fix-log lives in original repo)
  const toFix = await filterFixed(clusters, absRepoPath);

  if (toFix.length === 0) {
    const result: SweepLayerResult = {
      layer: layer.layer,
      tasks: [...layer.tasks],
      findings: clusters.length,
      fixed: 0,
      skipped: 0,
      failed: 0,
      keptBranches: [],
      regressions: [],
      durationMs: Date.now() - startMs,
    };
    return { result, criticalHigh: countCriticalHigh(clusters) };
  }

  // 3. Fix (batched: file-disjoint grouping, merge between batches)
  const fixResult: BatchedFixResult = await runBatchedFix({
    repoPath: sweepWorktreePath,
    clusters: toFix,
    agent: options.agents?.[0],
    timeoutMs: options.timeoutMs,
    models: options.models,
    scanModels: options.scanModels,
    concurrency: options.concurrency,
    auto: options.auto,
    verbose: options.verbose,
    validate: options.validate,
    reviewer: options.reviewer,
    fixLogPath: absRepoPath,
    onProgress: options.onFixProgress,
    onConfirm: options.onConfirm,
  });

  // Branches already merged inside runBatchedFix
  const mergedBranches = fixResult.keptBranches;

  // 4. Regression check (skip for first layer)
  const regressions: SweepRegression[] = [];
  if (prevLayer && mergedBranches.length > 0) {
    const regression = await checkRegressions(
      sweepWorktreePath, prevLayer, prevCriticalHigh, options,
    );

    if (regression) {
      regression.revertedBranches = [...mergedBranches];
      await revertMerges(sweepWorktreePath, mergedBranches);
      regressions.push(regression);
      log("warn", "Regression detected, reverted layer fixes", {
        round,
        layer: layer.layer,
        regression: regression.details,
      });
    }
  }

  // Count post-fix critical/high for this layer (for next layer's regression baseline)
  const postFixScan = await scanLayer(layer, sweepWorktreePath, options);
  const criticalHigh = countCriticalHigh(postFixScan.clusters);

  const result: SweepLayerResult = {
    layer: layer.layer,
    tasks: [...layer.tasks],
    findings: clusters.length,
    fixed: regressions.length > 0 ? 0 : fixResult.totalKept,
    skipped: fixResult.totalSkipped + fixResult.totalDiscarded,
    failed: fixResult.totalFailed,
    keptBranches: regressions.length > 0 ? [] : mergedBranches,
    regressions,
    durationMs: Date.now() - startMs,
  };

  return { result, criticalHigh };
}

/**
 * Run a full sweep: multi-round, layered scan→fix→regression loop.
 */
export async function runSweep(options: SweepOptions): Promise<SweepReport> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const expanded = options.repoPath.startsWith("~")
    ? path.join(os.homedir(), options.repoPath.slice(1))
    : options.repoPath;
  const absRepoPath = path.resolve(expanded);
  const startedAt = new Date().toISOString();

  await ensureCleanWorkTree(absRepoPath);

  // Create an isolated worktree for the sweep — user's checkout is never touched
  await pruneStaleWorktrees(absRepoPath);
  const { worktreePath: sweepWorktreePath, branch: sweepBranch } =
    await createSweepWorktree(absRepoPath);
  log("info", "Created sweep worktree", { sweepBranch, sweepWorktreePath });

  const rounds: SweepRoundResult[] = [];
  const allRegressions: SweepRegressionReport["regressions"] = [];
  let exitReason: SweepReport["exitReason"] = "max-rounds";

  try {
    for (let round = 1; round <= maxRounds; round++) {
      const roundStartMs = Date.now();
      const layerResults: SweepLayerResult[] = [];
      let prevLayer: SweepLayer | null = null;
      let prevCriticalHigh = 0;

      log("info", "Starting sweep round", { round, maxRounds });

      for (let i = 0; i < SWEEP_LAYERS.length; i++) {
        const layer = SWEEP_LAYERS[i]!;
        const { result, criticalHigh } = await executeLayer(
          round, layer, i, sweepWorktreePath, absRepoPath, options, prevLayer, prevCriticalHigh,
        );

        layerResults.push(result);
        options.onLayerComplete?.(round, result);

        // Track regressions for final report
        for (const reg of result.regressions) {
          allRegressions.push({
            round,
            layer: layer.layer,
            previousLayerTasks: reg.previousLayerTasks,
            revertedBranches: reg.revertedBranches,
            newCriticalHighCount: reg.newFindingCount,
            details: reg.details,
          });
        }

        prevLayer = layer;
        prevCriticalHigh = criticalHigh;
      }

      const roundResult: SweepRoundResult = {
        round,
        layers: layerResults,
        totalFindings: layerResults.reduce((s, l) => s + l.findings, 0),
        totalFixed: layerResults.reduce((s, l) => s + l.fixed, 0),
        totalRegressions: layerResults.reduce((s, l) => s + l.regressions.length, 0),
        criticalHighRemaining: 0, // computed below
        durationMs: Date.now() - roundStartMs,
      };

      // Check exit condition: re-scan security + qa for critical/high
      const secScan = await scanLayer(SWEEP_LAYERS[0]!, sweepWorktreePath, options);
      const qaScan = await scanLayer(SWEEP_LAYERS[1]!, sweepWorktreePath, options);
      const remainingCriticalHigh =
        countCriticalHigh(secScan.clusters) + countCriticalHigh(qaScan.clusters);
      roundResult.criticalHighRemaining = remainingCriticalHigh;

      rounds.push(roundResult);
      options.onRoundComplete?.(roundResult);

      if (remainingCriticalHigh === 0) {
        exitReason = "zero-critical-high";
        log("info", "Sweep exit: zero critical/high in security + qa", { round });
        break;
      }
    }
  } catch (err) {
    log("error", "Sweep failed", { error: String(err) });
  }

  // Collect remaining findings across all tasks (scan worktree, fix-log from original repo)
  const remaining: SweepRemaining[] = [];
  for (const layer of SWEEP_LAYERS) {
    const { clusters } = await scanLayer(layer, sweepWorktreePath, options);
    const unfixed = await filterFixed(clusters, absRepoPath);
    for (const c of unfixed) {
      remaining.push({
        clusterId: c.id,
        file: c.file,
        line: c.line,
        severity: c.severity,
        category: c.category,
        task: layer.tasks[0] ?? "unknown",
        rationale: c.rationales[0]?.rationale ?? "",
        reason: "not-fixed",
      });
    }
  }

  const report: SweepReport = {
    startedAt,
    completedAt: new Date().toISOString(),
    repoPath: absRepoPath,
    sweepBranch,
    totalRounds: rounds.length,
    maxRounds,
    exitReason,
    rounds,
    remaining,
  };

  // Write reports to original repo (not the worktree)
  await writeSweepReport(absRepoPath, report);
  if (allRegressions.length > 0) {
    await writeSweepRegressions(absRepoPath, {
      sweepBranch,
      regressions: allRegressions,
    });
  }

  // Clean up worktree but preserve the sweep branch for review
  await removeFixWorktree(absRepoPath, sweepWorktreePath, sweepBranch, false)
    .catch((err) => log("warn", "Failed to remove sweep worktree", { error: String(err) }));

  return report;
}
