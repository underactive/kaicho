import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { runSweep } from "../../orchestrator/run-sweep.js";
import { loadConfig, DEFAULT_TIMEOUT_MS } from "../../config/index.js";
import { DEFAULT_MAX_ROUNDS, type SweepLayer, type SweepLayerResult, type SweepRoundResult } from "../../orchestrator/sweep-types.js";
import type { ParallelFixProgress } from "../../orchestrator/run-parallel-fix.js";

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
  .option("--verbose", "Show detailed output")
  .action(async (opts) => {
    const rawRepo = opts.repo as string;
    const repoPath = rawRepo.startsWith("~")
      ? path.join(os.homedir(), rawRepo.slice(1))
      : path.resolve(rawRepo);

    const config = await loadConfig(repoPath);

    const agentsList = opts.agents
      ? (opts.agents as string).split(",").map((s: string) => s.trim())
      : config.agents;
    const excludeList = opts.exclude
      ? (opts.exclude as string).split(",").map((s: string) => s.trim())
      : undefined;

    const maxRounds = opts.maxRounds
      ? parseInt(opts.maxRounds as string, 10)
      : config.maxSweepRounds ?? DEFAULT_MAX_ROUNDS;

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
          ? ` | ${result.regressions.length} regressions (reverted)`
          : "";
        process.stderr.write(
          `  Layer ${result.layer}: ${result.findings} findings → ${result.fixed} fixed, ${result.skipped} skipped, ${result.failed} failed${regMsg}\n`,
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

    if (isTTY) {
      process.stderr.write(`\n═══ Sweep starting (max ${maxRounds} rounds) ═══\n`);
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

      process.stderr.write(`\n═══ Sweep complete ═══\n`);
      process.stderr.write(`  Rounds: ${report.totalRounds} of ${report.maxRounds} (exited: ${report.exitReason})\n`);
      process.stderr.write(`  Total fixed: ${totalFixed} | Regressions: ${totalReg}\n`);
      process.stderr.write(`  Remaining: ${report.remaining.length} (${sevStr})\n`);
      process.stderr.write(`  Report: .kaicho/sweep-report.json\n`);
      if (totalReg > 0) {
        process.stderr.write(`  Regressions: .kaicho/sweep-regressions.json\n`);
      }
      process.stderr.write(`  Branch: ${report.sweepBranch}\n`);
    } else {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    }
  });
