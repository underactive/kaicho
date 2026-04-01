import * as os from "node:os";
import * as path from "node:path";
import { runScan, type MultiScanResult } from "./run-scan.js";
import { runBatchedFix, type BatchedFixResult } from "./batched-fix.js";
import { execa } from "execa";
import {
  ensureCleanWorkTree,
  createSweepWorktree,
  removeFixWorktree,
  pruneStaleWorktrees,
  pruneOrphanFixBranches,
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
      onProgress: options.onScanProgress
        ? (p) => options.onScanProgress!({ ...p, task })
        : undefined,
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
 * Revert the last N merge commits (one per merged branch).
 *
 * Previous implementation called `git revert HEAD` N times, but each
 * revert moves HEAD — so the second call reverts the revert (reapply),
 * causing a flapping chain. Instead, revert the range in one shot.
 */
async function revertMerges(
  absRepoPath: string,
  mergedBranches: string[],
): Promise<void> {
  const n = mergedBranches.length;
  if (n === 0) return;

  try {
    await execa("git", ["revert", "--no-edit", `HEAD~${n}..HEAD`], {
      cwd: absRepoPath,
    });
    log("info", "Reverted merges", { count: n, branches: mergedBranches });
  } catch (err) {
    log("warn", "Failed to revert merges", {
      branches: mergedBranches,
      error: String(err),
    });
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
      flaggedBranches: [], // filled by caller
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
  prevLayers: Array<{ layer: SweepLayer; criticalHigh: number }>,
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
    agent: undefined, // let pickAgent use cluster.agents[0] (the finding agent)
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

  // 4. Regression check — flag regressions in all previous layers, don't revert
  const regressions: SweepRegression[] = [];
  if (prevLayers.length > 0 && mergedBranches.length > 0) {
    for (const prev of prevLayers) {
      const regression = await checkRegressions(
        sweepWorktreePath, prev.layer, prev.criticalHigh, options,
      );

      if (regression) {
        regression.flaggedBranches = [...mergedBranches];
        regressions.push(regression);
        log("warn", "Regression detected, fixes flagged for review", {
          round,
          layer: layer.layer,
          previousLayer: prev.layer.layer,
          regression: regression.details,
        });
      }
    }
  }

  // Count post-fix critical/high for this layer (for next layer's regression baseline).
  // Skip the re-scan if no fixes were merged (code hasn't changed) or if no
  // previous layers will use the baseline (e.g. Pass 1 of two-pass has no regression checks).
  let criticalHigh: number;
  if (mergedBranches.length > 0 && prevLayers.length > 0) {
    log("info", "Re-scanning layer for regression baseline", { layer: layer.layer, tasks: layer.tasks });
    options.onScanProgress?.({ agent: "sweep", status: "started", task: `baseline-rescan:${layer.tasks.join(",")}` });
    criticalHigh = countCriticalHigh((await scanLayer(layer, sweepWorktreePath, options)).clusters);
  } else {
    criticalHigh = countCriticalHigh(clusters);
  }

  const result: SweepLayerResult = {
    layer: layer.layer,
    tasks: [...layer.tasks],
    findings: clusters.length,
    fixed: fixResult.totalKept,
    skipped: fixResult.totalSkipped + fixResult.totalDiscarded,
    failed: fixResult.totalFailed,
    keptBranches: mergedBranches,
    regressions,
    durationMs: Date.now() - startMs,
  };

  return { result, criticalHigh };
}

/**
 * Two-pass sweep: Pass 1 cleans all layers low→high (no regression checks,
 * no validation). Pass 2 runs security + QA with full checks on the clean base.
 */
async function runTwoPassSweep(
  sweepWorktreePath: string,
  absRepoPath: string,
  options: SweepOptions,
  sweepBranch: string,
  maxRounds: number,
): Promise<{
  rounds: SweepRoundResult[];
  regressions: SweepRegressionReport["regressions"];
  exitReason: SweepReport["exitReason"];
}> {
  const rounds: SweepRoundResult[] = [];
  const allRegressions: SweepRegressionReport["regressions"] = [];
  let exitReason: SweepReport["exitReason"] = "max-rounds";

  // ── Pass 1: all layers reversed, no regression checks, no validation ──
  {
    const roundStartMs = Date.now();
    const layerResults: SweepLayerResult[] = [];
    const pass1Options: SweepOptions = { ...options, validate: false };
    const reversedLayers = [...SWEEP_LAYERS].reverse();

    log("info", "Two-pass sweep: starting Pass 1 (speed run)", {
      layers: reversedLayers.map((l) => l.layer),
    });

    for (let i = 0; i < reversedLayers.length; i++) {
      const layer = reversedLayers[i]!;
      try {
        const { result } = await executeLayer(
          1, layer, i, sweepWorktreePath, absRepoPath, pass1Options, [],
        );
        layerResults.push(result);
        options.onLayerComplete?.(1, result);

        if (result.keptBranches.length > 0) {
          await execa("git", ["tag", `${sweepBranch}/pass1-layer-${layer.layer}`, "HEAD"], {
            cwd: sweepWorktreePath, reject: false,
          });
        }
      } catch (err) {
        log("error", "Pass 1 layer failed, continuing", { layer: layer.layer, error: String(err) });
        await execa("git", ["reset", "--merge"], { cwd: sweepWorktreePath, reject: false });
      }
    }

    const roundResult: SweepRoundResult = {
      round: 1,
      pass: 1,
      layers: layerResults,
      totalFindings: layerResults.reduce((s, l) => s + l.findings, 0),
      totalFixed: layerResults.reduce((s, l) => s + l.fixed, 0),
      totalRegressions: 0,
      criticalHighRemaining: 0,
      durationMs: Date.now() - roundStartMs,
    };
    rounds.push(roundResult);
    options.onRoundComplete?.(roundResult);
  }

  // ── Pass 2: security + QA only, with regression checks + validation ──
  if (maxRounds >= 2) {
    const roundStartMs = Date.now();
    const layerResults: SweepLayerResult[] = [];
    const prevLayers: Array<{ layer: SweepLayer; criticalHigh: number }> = [];
    const pass2Layers = SWEEP_LAYERS.slice(0, 2);

    log("info", "Two-pass sweep: starting Pass 2 (security + qa)", {
      layers: pass2Layers.map((l) => l.layer),
    });

    for (let i = 0; i < pass2Layers.length; i++) {
      const layer = pass2Layers[i]!;
      try {
        const { result, criticalHigh } = await executeLayer(
          2, layer, i, sweepWorktreePath, absRepoPath, options, prevLayers,
        );
        layerResults.push(result);
        options.onLayerComplete?.(2, result);

        for (const reg of result.regressions) {
          allRegressions.push({
            round: 2, layer: layer.layer,
            previousLayerTasks: reg.previousLayerTasks,
            flaggedBranches: reg.flaggedBranches,
            newCriticalHighCount: reg.newFindingCount,
            details: reg.details,
          });
        }

        if (result.keptBranches.length > 0) {
          await execa("git", ["tag", `${sweepBranch}/pass2-layer-${layer.layer}`, "HEAD"], {
            cwd: sweepWorktreePath, reject: false,
          });
        }

        prevLayers.push({ layer, criticalHigh });
      } catch (err) {
        log("error", "Pass 2 layer failed, continuing", { layer: layer.layer, error: String(err) });
        await execa("git", ["reset", "--merge"], { cwd: sweepWorktreePath, reject: false });
      }
    }

    // Exit condition: check critical/high remaining in security + qa
    let criticalHighRemaining = 0;
    try {
      const secScan = await scanLayer(SWEEP_LAYERS[0]!, sweepWorktreePath, options);
      const qaScan = await scanLayer(SWEEP_LAYERS[1]!, sweepWorktreePath, options);
      criticalHighRemaining = countCriticalHigh(secScan.clusters) + countCriticalHigh(qaScan.clusters);
    } catch (err) {
      log("warn", "Exit condition scan failed", { error: String(err) });
    }

    const roundResult: SweepRoundResult = {
      round: 2,
      pass: 2,
      layers: layerResults,
      totalFindings: layerResults.reduce((s, l) => s + l.findings, 0),
      totalFixed: layerResults.reduce((s, l) => s + l.fixed, 0),
      totalRegressions: layerResults.reduce((s, l) => s + l.regressions.length, 0),
      criticalHighRemaining,
      durationMs: Date.now() - roundStartMs,
    };
    rounds.push(roundResult);
    options.onRoundComplete?.(roundResult);

    if (criticalHighRemaining === 0) {
      exitReason = "zero-critical-high";
    }
  }

  return { rounds, regressions: allRegressions, exitReason };
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
    if (options.twoPass) {
      const twoPassResult = await runTwoPassSweep(
        sweepWorktreePath, absRepoPath, options, sweepBranch, maxRounds,
      );
      rounds.push(...twoPassResult.rounds);
      allRegressions.push(...twoPassResult.regressions);
      exitReason = twoPassResult.exitReason;
    } else for (let round = 1; round <= maxRounds; round++) {
      const roundStartMs = Date.now();
      const layerResults: SweepLayerResult[] = [];
      const prevLayers: Array<{ layer: SweepLayer; criticalHigh: number }> = [];

      log("info", "Starting sweep round", { round, maxRounds });

      for (let i = 0; i < SWEEP_LAYERS.length; i++) {
        const layer = SWEEP_LAYERS[i]!;
        try {
          const { result, criticalHigh } = await executeLayer(
            round, layer, i, sweepWorktreePath, absRepoPath, options, prevLayers,
          );

          layerResults.push(result);
          options.onLayerComplete?.(round, result);

          // Tag the sweep branch after each layer that merged fixes
          if (result.keptBranches.length > 0) {
            const tag = `${sweepBranch}/r${round}-layer-${layer.layer}`;
            await execa("git", ["tag", tag, "HEAD"], {
              cwd: sweepWorktreePath,
              reject: false,
            });
          }

          // Track regressions for final report
          for (const reg of result.regressions) {
            allRegressions.push({
              round,
              layer: layer.layer,
              previousLayerTasks: reg.previousLayerTasks,
              flaggedBranches: reg.flaggedBranches,
              newCriticalHighCount: reg.newFindingCount,
              details: reg.details,
            });
          }

          prevLayers.push({ layer, criticalHigh });
        } catch (err) {
          log("error", "Layer failed, continuing", { round, layer: layer.layer, error: String(err) });
          // Safety net: if a layer left the worktree dirty (e.g. unresolved
          // squash-merge conflict), clean it up so the next layer can start.
          await execa("git", ["reset", "--merge"], {
            cwd: sweepWorktreePath,
            reject: false,
          });
        }
      }

      const roundResult: SweepRoundResult = {
        round,
        layers: layerResults,
        totalFindings: layerResults.reduce((s, l) => s + l.findings, 0),
        totalFixed: layerResults.reduce((s, l) => s + l.fixed, 0),
        totalRegressions: layerResults.reduce((s, l) => s + l.regressions.length, 0),
        criticalHighRemaining: 0, // updated below if exit scan succeeds
        durationMs: Date.now() - roundStartMs,
      };

      // Push round data immediately so it survives exit-scan failures
      rounds.push(roundResult);

      // Check exit condition: re-scan security + qa for critical/high.
      // Skip on the final round — no point checking when there's no next round to skip.
      if (round < maxRounds) {
        try {
          const secScan = await scanLayer(SWEEP_LAYERS[0]!, sweepWorktreePath, options);
          const qaScan = await scanLayer(SWEEP_LAYERS[1]!, sweepWorktreePath, options);
          const remainingCriticalHigh =
            countCriticalHigh(secScan.clusters) + countCriticalHigh(qaScan.clusters);
          roundResult.criticalHighRemaining = remainingCriticalHigh;
        } catch (err) {
          log("warn", "Exit condition scan failed", { error: String(err) });
        }
      }

      options.onRoundComplete?.(roundResult);

      if (round < maxRounds && roundResult.criticalHighRemaining === 0) {
        exitReason = "zero-critical-high";
        log("info", "Sweep exit: zero critical/high in security + qa", { round });
        break;
      }
    }
  } catch (err) {
    log("error", "Sweep failed", { error: String(err) });
  }

  // Collect remaining findings across all tasks (scan worktree, fix-log from original repo).
  // Skipped by default — this is an expensive full re-scan across all layers. Enable with --final-scan.
  const remaining: SweepRemaining[] = [];
  if (options.finalScan) {
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
  }

  const report: SweepReport = {
    startedAt,
    completedAt: new Date().toISOString(),
    repoPath: absRepoPath,
    sweepBranch,
    totalRounds: rounds.length,
    maxRounds,
    exitReason,
    strategy: options.twoPass ? "two-pass" : "single-pass",
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

  // Delete orphaned kaicho/fix-* branches left behind by failed merges
  await pruneOrphanFixBranches(absRepoPath)
    .catch((err) => log("warn", "Failed to prune orphan fix branches", { error: String(err) }));

  return report;
}
