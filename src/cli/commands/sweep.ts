import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { runSweep } from "../../orchestrator/run-sweep.js";
import { loadConfig, DEFAULT_TIMEOUT_MS } from "../../config/index.js";
import { DEFAULT_MAX_ROUNDS, type SweepLayer, type SweepLayerResult, type SweepRoundResult } from "../../orchestrator/sweep-types.js";
import type { ParallelFixProgress } from "../../orchestrator/run-parallel-fix.js";
import type { ScanProgress } from "../../orchestrator/run-scan.js";

const NO_COLOR = "NO_COLOR" in process.env;

function color(text: string, code: string): string {
  if (NO_COLOR) return text;
  return `${code}${text}\x1b[0m`;
}

export const sweepCommand = new Command("sweep")
  .description("Run a layered, multi-round scan-fix-verify loop across all task types")
  .option("--repo <path>", "Path to target repository", ".")
  .option("--auto", "Fix without confirmations (auto-keep approved, auto-discard concerns)")
  .option("--max-rounds <n>", "Maximum sweep rounds")
  .option("--agents <agents>", "Agents to use (comma-separated, default: all available)")
  .option("--exclude <agents>", "Exclude agents (comma-separated)")
  .option("--timeout <ms>", "Agent timeout in milliseconds")
  .option("--validate", "Cross-agent validation on fixes")
  .option("--reviewer <agent>", "Reviewer agent for validation")
  .option("--concurrency <n>", "Parallel fix concurrency")
  .option("--final-scan", "Run a full re-scan after all rounds to report remaining findings")
  .option("--two-pass", "Two-pass strategy: speed-run all layers, then thorough security+qa pass")
  .option("--verbose", "Show detailed output")
  .action(async (opts) => {
    const rawRepo = opts.repo as string;
    const repoPath = rawRepo.startsWith("~")
      ? path.join(os.homedir(), rawRepo.slice(1))
      : path.resolve(rawRepo);

    const config = await loadConfig(repoPath);

    // Tee all stderr output to a log file in .kaicho/
    const kaichoDir = path.join(repoPath, ".kaicho");
    fs.mkdirSync(kaichoDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = path.join(kaichoDir, `sweep-${timestamp}.log`);
    const logStream = fs.createWriteStream(logPath);
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      logStream.write(chunk);
      return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stderr.write;

    const agentsList = opts.agents
      ? (opts.agents as string).split(",").map((s: string) => s.trim())
      : config.agents;
    const excludeList = opts.exclude
      ? (opts.exclude as string).split(",").map((s: string) => s.trim())
      : undefined;

    let maxRounds = opts.maxRounds
      ? parseInt(opts.maxRounds as string, 10)
      : config.maxSweepRounds ?? DEFAULT_MAX_ROUNDS;

    if (opts.twoPass && maxRounds < 2) {
      maxRounds = 2;
    }

    const isTTY = process.stderr.isTTY;

    const onLayerStart = (_round: number, layer: SweepLayer): void => {
      if (isTTY) {
        process.stderr.write(`\n── Layer ${layer.layer}: ${layer.tasks.join(", ")} ──\n`);
        process.stderr.write("  Scanning...\n");
      }
    };

    const onLayerComplete = (_round: number, result: SweepLayerResult): void => {
      if (isTTY) {
        const regMsg = result.regressions.length > 0
          ? ` | ${result.regressions.length} regressions (flagged)`
          : "";
        const elapsed = (result.durationMs / 1000).toFixed(1);
        process.stderr.write(
          `  Layer ${result.layer}: ${result.findings} findings → ${result.fixed} fixed, ${result.skipped} skipped, ${result.failed} failed${regMsg} (${elapsed}s)\n`,
        );
      }
    };

    const onRoundComplete = (result: SweepRoundResult): void => {
      if (isTTY) {
        process.stderr.write(
          `\n═══ Round ${result.round} complete: ${result.totalFindings} findings → ${result.totalFixed} fixed, ${result.criticalHighRemaining} critical/high remaining ═══\n`,
        );
      }
    };

    const onFixProgress = (p: ParallelFixProgress): void => {
      if (isTTY) {
        if (p.step === "creating-worktree") {
          const summaryLine = p.summary ? `\n         ${color(p.summary, "\x1b[37m")}` : "";
          process.stderr.write(`    ${color(`[${p.current}/${p.total}]`, "\x1b[90m")} ${p.clusterId} ${p.file} — ${p.agent} starting...${summaryLine}\n`);
        } else if (p.step === "applied") {
          process.stderr.write(`    ${color(`[${p.current}/${p.total}]`, "\x1b[90m")} ${p.clusterId} ${color("applied", "\x1b[32m")} → ${color(p.branch ?? "", "\x1b[1m")} (${p.filesChanged} file${p.filesChanged === 1 ? "" : "s"})\n`);
        } else if (p.step === "no-changes") {
          process.stderr.write(`    ${color(`[${p.current}/${p.total}]`, "\x1b[90m")} ${p.clusterId} ${color("no changes", "\x1b[33m")}\n`);
        } else if (p.step === "failed") {
          process.stderr.write(`    ${color(`[${p.current}/${p.total}]`, "\x1b[90m")} ${p.clusterId} ${color("failed", "\x1b[31m")} — ${p.error}\n`);
        }
      } else {
        process.stderr.write(JSON.stringify({ type: "sweep.fix-progress", ...p }) + "\n");
      }
    };

    const formatElapsed = (ms: number): string => {
      const s = Math.floor(ms / 1000);
      return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
    };

    const onScanProgress = (p: ScanProgress): void => {
      // Sweep phase transition messages
      if (p.agent === "sweep") {
        if (isTTY) {
          if (p.task === "pass-1") {
            process.stderr.write(`\n${color("── Pass 1: speed run (all layers, no regression checks) ──", "\x1b[1m")}\n`);
          } else if (p.task === "pass-2") {
            process.stderr.write(`\n${color("── Pass 2: thorough (security + qa, with regression checks) ──", "\x1b[1m")}\n`);
          } else if (p.task?.startsWith("regression-check:")) {
            const tasks = p.task.slice("regression-check:".length);
            process.stderr.write(`  Checking for regressions in ${tasks}...\n`);
          } else if (p.task?.startsWith("baseline-rescan:")) {
            const tasks = p.task.slice("baseline-rescan:".length);
            process.stderr.write(`  Re-scanning ${tasks} for regression baseline...\n`);
          } else if (p.task === "exit-condition-check") {
            process.stderr.write(`  Checking exit condition (security + qa)...\n`);
          } else if (p.task === "final-scan") {
            process.stderr.write(`\n  Running final scan for remaining findings...\n`);
          }
        }
        return;
      }

      const task = p.task ? ` [${p.task}]` : "";
      if (isTTY) {
        if (p.status === "started") {
          process.stderr.write(`    ${color(p.agent, "\x1b[36m")}${task} scanning...\n`);
        } else if (p.status === "running") {
          process.stderr.write(`    ${color(p.agent, "\x1b[90m")}${task} still running (${formatElapsed(p.durationMs ?? 0)})\n`);
        } else if (p.status === "done") {
          const elapsed = formatElapsed(p.durationMs ?? 0);
          if (p.error) {
            process.stderr.write(`    ${color(p.agent, "\x1b[31m")}${task} ${color("error", "\x1b[31m")} (${elapsed}) — ${p.error}\n`);
          } else {
            process.stderr.write(`    ${color(p.agent, "\x1b[32m")}${task} ${color("done", "\x1b[32m")} — ${p.suggestions} suggestions (${elapsed})\n`);
          }
        } else if (p.status === "skipped") {
          process.stderr.write(`    ${color(p.agent, "\x1b[33m")}${task} ${color("skipped", "\x1b[33m")} — not available\n`);
        }
      } else {
        process.stderr.write(JSON.stringify({ type: "sweep.scan-progress", ...p }) + "\n");
      }
    };

    if (isTTY) {
      const strategyLabel = opts.twoPass ? "two-pass" : "standard";
      process.stderr.write(`\n═══ Sweep starting (${strategyLabel}, max ${maxRounds} rounds) ═══\n`);
    }

    const report = await runSweep({
      repoPath: rawRepo,
      maxRounds,
      auto: opts.auto === true,
      agents: agentsList,
      exclude: excludeList,
      timeoutMs: opts.timeout ? parseInt(opts.timeout as string, 10) : DEFAULT_TIMEOUT_MS,
      models: config.fixModels ?? config.models,
      scanModels: config.models,
      concurrency: opts.concurrency ? parseInt(opts.concurrency as string, 10) : config.concurrency ?? 3,
      validate: opts.validate === true,
      reviewer: opts.reviewer as string | undefined ?? config.reviewer,
      verbose: opts.verbose === true,
      finalScan: opts.finalScan === true,
      twoPass: opts.twoPass === true,
      onScanProgress,
      onLayerStart,
      onLayerComplete,
      onRoundComplete,
      onFixProgress,
    });

    // Final summary
    if (isTTY) {
      const totalFixed = report.rounds.reduce((s, r) => s + r.totalFixed, 0);
      const totalReg = report.rounds.reduce((s, r) => s + r.totalRegressions, 0);

      const bySeverity: Record<string, number> = {};
      for (const r of report.remaining) {
        bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
      }
      const sevStr = Object.entries(bySeverity)
        .map(([s, n]) => `${n} ${s}`)
        .join(", ") || "none";

      const elapsedMs = new Date(report.completedAt).getTime() - new Date(report.startedAt).getTime();
      process.stderr.write(`\n═══ Sweep complete (${formatElapsed(elapsedMs)}) ═══\n`);
      process.stderr.write(`  Rounds: ${report.totalRounds} of ${report.maxRounds} (exited: ${report.exitReason})\n`);
      process.stderr.write(`  Total fixed: ${totalFixed} | Regressions: ${totalReg}\n`);
      process.stderr.write(`  Remaining: ${report.remaining.length} (${sevStr})\n`);
      process.stderr.write(`  Report: .kaicho/sweep-report.json\n`);
      if (totalReg > 0) {
        process.stderr.write(`  ${color("Regressions flagged — review before merging: .kaicho/sweep-regressions.json", "\x1b[33m")}\n`);
      }
      if (report.manualActions.length > 0) {
        process.stderr.write(`\n  ${color("Manual actions required:", "\x1b[33m")}\n`);
        for (const a of report.manualActions) {
          process.stderr.write(`    ${color("!", "\x1b[33m")} ${a.action}\n`);
          process.stderr.write(`      ${color(`${a.file} — ${a.category}/${a.severity} [${a.clusterId}]`, "\x1b[90m")}\n`);
        }
      }
      process.stderr.write(`  Branch: ${report.sweepBranch} (not checked out)\n`);
      process.stderr.write(`  Log: ${path.relative(repoPath, logPath)}\n`);
    } else {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    }

    // Restore stderr and close log file
    process.stderr.write = originalWrite;
    logStream.end();
  });
