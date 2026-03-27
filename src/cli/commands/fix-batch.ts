import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { runParallelFix, runValidation, type ParallelFixItemResult, type ParallelFixConfirmResult } from "../../orchestrator/index.js";
import { loadConfig } from "../../config/index.js";
import type { SuggestionCluster } from "../../dedup/index.js";

const NO_COLOR = "NO_COLOR" in process.env;

function color(text: string, code: string): string {
  if (NO_COLOR) return text;
  return `${code}${text}\x1b[0m`;
}

export async function handleParallelBatchFix(
  rawRepo: string,
  clusters: SuggestionCluster[],
  opts: Record<string, unknown>,
): Promise<void> {
  const out = process.stdout;
  const isTTY = process.stderr.isTTY;
  const isAuto = opts["auto"] === true;
  const doValidate = opts["validate"] === true;
  const repoPath = rawRepo.startsWith("~")
    ? path.join(os.homedir(), rawRepo.slice(1))
    : path.resolve(rawRepo);
  const config = doValidate ? await loadConfig(repoPath) : undefined;

  out.write(`\n  Parallel fixing ${clusters.length} finding${clusters.length === 1 ? "" : "s"} (up to 3 concurrent)${isAuto ? " (auto)" : ""}${doValidate ? " + validation" : ""}...\n\n`);

  try {
    const result = await runParallelFix({
      repoPath: rawRepo,
      clusters,
      agent: opts["agent"] as string | undefined,
      timeoutMs: parseInt((opts["timeout"] as string) ?? "1800000", 10),
      concurrency: 3,
      auto: isAuto,
      verbose: opts["verbose"] === true,
      onProgress: (p) => {
        if (isTTY) {
          if (p.step === "creating-worktree") {
            const summaryLine = p.summary ? `\n       ${color(p.summary, "\x1b[37m")}` : "";
            out.write(`  ${color(`[${p.current}/${p.total}]`, "\x1b[90m")} ${p.clusterId} ${p.file} — ${p.agent} starting...${summaryLine}\n`);
          } else if (p.step === "applied") {
            out.write(`  ${color(`[${p.current}/${p.total}]`, "\x1b[90m")} ${p.clusterId} ${color("applied", "\x1b[32m")} → ${color(p.branch ?? "", "\x1b[1m")} (${p.filesChanged} file${p.filesChanged === 1 ? "" : "s"})\n`);
          } else if (p.step === "no-changes") {
            out.write(`  ${color(`[${p.current}/${p.total}]`, "\x1b[90m")} ${p.clusterId} ${color("no changes", "\x1b[33m")}\n`);
          } else if (p.step === "failed") {
            out.write(`  ${color(`[${p.current}/${p.total}]`, "\x1b[90m")} ${p.clusterId} ${color("failed", "\x1b[31m")} — ${p.error}\n`);
          }
        } else {
          process.stderr.write(JSON.stringify({ type: "parallel-fix.progress", ...p }) + "\n");
        }
      },
      onConfirm: isAuto ? undefined : async (item, cluster, current, total) => {
        return confirmFix(item, cluster, current, total, rawRepo, opts, config);
      },
    });

    // Summary
    const duration = (result.totalDurationMs / 1000).toFixed(1);
    out.write(`\n  ${color("Batch complete:", "\x1b[1m")} ${result.totalApplied} applied, ${result.totalKept} kept, ${result.totalDiscarded} discarded, ${result.totalSkipped} skipped, ${result.totalFailed} failed (${duration}s)\n`);

    if (result.keptBranches.length > 0) {
      out.write(`\n  ${color("Kept branches:", "\x1b[1m")}\n`);
      for (const branch of result.keptBranches) {
        out.write(`    ${color(branch, "\x1b[32m")}\n`);
      }
      out.write(`\n  Merge with: ${color("git merge <branch>", "\x1b[90m")}\n\n`);
    } else {
      out.write("\n  No branches kept.\n\n");
    }

    // Warn if two kept branches touch the same file
    const fileMap = new Map<string, string[]>();
    for (const item of result.items) {
      if (result.keptBranches.includes(item.branch) && item.status === "applied") {
        const list = fileMap.get(item.file) ?? [];
        list.push(item.branch);
        fileMap.set(item.file, list);
      }
    }
    for (const [file, branches] of fileMap) {
      if (branches.length > 1) {
        out.write(`  ${color("Warning:", "\x1b[33m")} ${file} modified by multiple kept branches: ${branches.join(", ")}\n`);
        out.write(`  These may conflict when merging.\n\n`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`  ${color("Error:", "\x1b[31m")} ${msg}\n\n`);
    process.exit(1);
  }
}

async function confirmFix(
  item: ParallelFixItemResult,
  cluster: SuggestionCluster,
  current: number,
  total: number,
  rawRepo: string,
  opts: Record<string, unknown>,
  config: Awaited<ReturnType<typeof loadConfig>> | undefined,
): Promise<ParallelFixConfirmResult> {
  const out = process.stdout;
  const doValidate = opts["validate"] === true;

  out.write(`\n  ${color(`--- Fix ${current}/${total}:`, "\x1b[1m")} ${item.clusterId} ${item.file} (${color(item.agent, "\x1b[1m")} → ${color(item.branch, "\x1b[36m")})\n`);

  if (item.diff) {
    out.write(`\n${item.diff}\n`);
  }

  // Validate if requested
  if (doValidate && item.diff && item.status === "applied") {
    out.write(`  ${color("Validating...", "\x1b[90m")}\n`);
    const reviewerOverride = (opts["reviewer"] as string | undefined) ?? config?.reviewer;
    const validation = await runValidation({
      repoPath: rawRepo,
      cluster,
      diff: item.diff,
      fixAgent: item.agent,
      timeoutMs: parseInt((opts["timeout"] as string) ?? "1800000", 10),
      models: config?.models,
      reviewer: reviewerOverride,
      verbose: opts["verbose"] === true,
      fixerContext: item.fixerContext,
    });

    if (validation.verdict === "approve") {
      out.write(`  ${color("Approved", "\x1b[32m")} by ${color(validation.reviewer, "\x1b[1m")}: ${validation.rationale}\n\n`);
    } else if (validation.verdict === "concern") {
      out.write(`  ${color("Concern", "\x1b[33m")} from ${color(validation.reviewer, "\x1b[1m")}: ${validation.rationale}\n\n`);
      const retryCtx = !item.retryOf
        ? { reviewer: validation.reviewer, concern: validation.rationale }
        : undefined;
      return promptFixAction(item.branch, retryCtx);
    } else {
      out.write(`  ${color("Validation:", "\x1b[90m")} ${validation.rationale}\n\n`);
    }
  }

  return promptFixAction(item.branch);
}

async function promptFixAction(
  branch: string,
  retryContext?: { reviewer: string; concern: string },
): Promise<ParallelFixConfirmResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const retryHint = retryContext
      ? ` / ${color(`Retry with ${retryContext.reviewer}`, "\x1b[36m")} (r)`
      : "";
    const answer = await rl.question(`  Keep / Discard${retryHint}? (k/d${retryContext ? "/r" : ""}): `);
    const ch = answer.trim().toLowerCase();
    if (ch.startsWith("r") && retryContext) {
      return { action: "retry", reviewer: retryContext.reviewer, concern: retryContext.concern };
    }
    if (ch.startsWith("d")) return "discard";
    return "keep";
  } finally {
    rl.close();
  }
}
