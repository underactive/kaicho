import * as os from "node:os";
import * as path from "node:path";
import type { SuggestionCluster } from "../dedup/index.js";
import { buildMultiFixPrompt, extractFixerContext, extractManualActions } from "../prompts/index.js";
import { buildGroupCommitMessage } from "./commit-message.js";
import { resolveAdapter } from "./resolve-adapter.js";
import { resolveModel } from "../config/index.js";
import {
  ensureCleanWorkTree,
  getCurrentBranch,
  captureDiff,
  commitFix,
  createFixWorktree,
  removeFixWorktree,
  pruneStaleWorktrees,
  cleanupWorktreeBase,
} from "../branch/index.js";
import { runValidation, type ValidateResult } from "./run-validate.js";
import { recordFix, recordDiscardedFix } from "../fix-log/index.js";
import { fingerprint, formatContextForFile, type RepoContext } from "../repo-context/index.js";
import { log } from "../logger/index.js";
import type {
  ParallelFixItemResult,
  ParallelFixResult,
  ParallelFixProgress,
  ParallelFixOptions,
} from "./run-parallel-fix.js";
import type { DiscardedFixEntry } from "../fix-log/index.js";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export interface GroupedFixOptions {
  repoPath: string;
  clusters: SuggestionCluster[];
  agent?: string;
  timeoutMs?: number;
  models?: Record<string, string>;
  scanModels?: Record<string, string>;
  auto?: boolean;
  verbose?: boolean;
  validate?: boolean;
  reviewers?: string[];
  fixLogPath?: string;
  onProgress?: (progress: ParallelFixProgress) => void;
  onConfirm?: ParallelFixOptions["onConfirm"];
}

/**
 * Build a synthetic cluster that merges all clusters' metadata.
 * Used for validation — the reviewer sees all rationales and the highest severity.
 */
function buildSyntheticCluster(clusters: SuggestionCluster[]): SuggestionCluster {
  const allRationales = clusters.flatMap((c) => c.rationales);
  const allAgents = [...new Set(clusters.flatMap((c) => c.agents))];
  const highest = clusters.reduce((best, c) =>
    (SEVERITY_RANK[c.severity] ?? 5) < (SEVERITY_RANK[best.severity] ?? 5) ? c : best,
  );

  return {
    id: clusters.map((c) => c.id).join("+"),
    file: clusters[0]!.file,
    line: clusters[0]!.line,
    category: [...new Set(clusters.map((c) => c.category))].join(", "),
    severity: highest.severity,
    agents: allAgents,
    agreement: Math.max(...clusters.map((c) => c.agreement)),
    rationales: allRationales,
    suggestedChange: null,
    items: clusters.flatMap((c) => c.items),
  };
}

function buildDiscardedEntry(
  clusterId: string,
  cluster: SuggestionCluster,
  agent: string,
  diff: string,
  validation: ValidateResult | undefined,
  reason: DiscardedFixEntry["reason"],
): DiscardedFixEntry {
  return {
    clusterId,
    file: cluster.file,
    line: cluster.line,
    category: cluster.category,
    severity: cluster.severity,
    summary: cluster.summary ?? null,
    fixAgent: agent,
    fixDiff: diff,
    fixerContext: null,
    reviewer: validation?.reviewer ?? null,
    verdict: validation?.verdict ?? null,
    reviewerRationale: validation?.rationale ?? null,
    retryAttempted: false,
    discardedAt: new Date().toISOString(),
    reason,
  };
}

/**
 * Process multiple same-file clusters in a single agent session.
 *
 * Creates one worktree, builds one multi-fix prompt, runs one agent,
 * validates once, and returns results for all clusters. This avoids
 * the per-cluster overhead of worktree creation, agent invocation,
 * validation, and merge that makes the serial phase slow.
 *
 * All clusters must share the same `file` property.
 */
export async function runGroupedFix(
  options: GroupedFixOptions,
): Promise<ParallelFixResult> {
  const { clusters } = options;
  const file = clusters[0]!.file;
  const startMs = Date.now();

  // Precondition: all clusters must target the same file
  for (const c of clusters) {
    if (c.file !== file) {
      throw new Error(`runGroupedFix: all clusters must share the same file. Expected "${file}", got "${c.file}"`);
    }
  }

  const expanded = options.repoPath.startsWith("~")
    ? path.join(os.homedir(), options.repoPath.slice(1))
    : options.repoPath;
  const absRepoPath = path.resolve(expanded);
  const fixLogRoot = options.fixLogPath
    ? path.resolve(options.fixLogPath)
    : absRepoPath;
  const notify = options.onProgress ?? (() => {});

  await ensureCleanWorkTree(absRepoPath);
  await pruneStaleWorktrees(absRepoPath);

  // Fingerprint for repo context
  let repoCtx: RepoContext | undefined;
  try {
    repoCtx = await fingerprint(absRepoPath);
  } catch {
    // Continue without context
  }

  const baseBranch = await getCurrentBranch(absRepoPath);

  // Pick agent from first cluster (all same file, likely same agents)
  const agentName = options.agent ?? clusters[0]!.agents[0] ?? "claude";

  // Create a single worktree for the group
  notify({ current: 1, total: clusters.length, clusterId: clusters[0]!.id, file, step: "creating-worktree", agent: agentName });

  let worktreePath: string;
  let branch: string;
  try {
    const wt = await createFixWorktree(absRepoPath);
    worktreePath = wt.worktreePath;
    branch = wt.branch;
  } catch (err) {
    const items: ParallelFixItemResult[] = clusters.map((c) => ({
      clusterId: c.id, file: c.file, agent: agentName, branch: "", worktreePath: "",
      status: "agent-error" as const, filesChanged: 0, durationMs: Date.now() - startMs, diff: "",
      error: `Failed to create worktree: ${String(err)}`,
    }));
    return makeGroupResult(items, [], startMs);
  }

  try {
    const adapter = resolveAdapter(agentName, options.timeoutMs, resolveModel(agentName, options.models), options.verbose);
    if (!(await adapter.isAvailable())) {
      await removeFixWorktree(absRepoPath, worktreePath, branch, true);
      const items: ParallelFixItemResult[] = clusters.map((c) => ({
        clusterId: c.id, file: c.file, agent: agentName, branch, worktreePath,
        status: "agent-error" as const, filesChanged: 0, durationMs: Date.now() - startMs, diff: "",
        error: `Agent "${agentName}" not installed`,
      }));
      return makeGroupResult(items, [], startMs);
    }

    // Build and run multi-fix prompt
    for (const c of clusters) {
      notify({ current: 1, total: clusters.length, clusterId: c.id, file, step: "running-agent", agent: agentName, branch });
    }
    log("info", "Grouped fix", { agent: agentName, file, clusters: clusters.length, branch });

    const repoContext = repoCtx ? (formatContextForFile(repoCtx, file) || undefined) : undefined;
    const prompt = buildMultiFixPrompt(clusters, repoContext);
    const result = await adapter.run(worktreePath, prompt, "fix");

    if (result.status !== "success") {
      await removeFixWorktree(absRepoPath, worktreePath, branch, true);
      const items: ParallelFixItemResult[] = clusters.map((c) => ({
        clusterId: c.id, file: c.file, agent: agentName, branch, worktreePath,
        status: "agent-error" as const, filesChanged: 0, durationMs: Date.now() - startMs, diff: "",
        error: result.error ?? result.status,
      }));
      return makeGroupResult(items, [], startMs);
    }

    const { diff, filesChanged } = await captureDiff(worktreePath, baseBranch);

    if (filesChanged === 0) {
      await removeFixWorktree(absRepoPath, worktreePath, branch, true);
      for (const c of clusters) {
        notify({ current: 1, total: clusters.length, clusterId: c.id, file, step: "no-changes" });
      }
      const items: ParallelFixItemResult[] = clusters.map((c) => ({
        clusterId: c.id, file: c.file, agent: agentName, branch, worktreePath,
        status: "no-changes" as const, filesChanged: 0, durationMs: Date.now() - startMs, diff: "",
      }));
      return makeGroupResult(items, [], startMs);
    }

    const fixerContext = extractFixerContext(result.rawOutput) ?? undefined;
    const manualActions = extractManualActions(result.rawOutput);

    // Validate once with a synthetic cluster
    let validation: ValidateResult | undefined;
    let reviewerInfo: import("./commit-message.js").CommitMessageReviewer | undefined;
    if (options.validate) {
      const syntheticCluster = buildSyntheticCluster(clusters);
      const valResult = await runValidation({
        repoPath: worktreePath,
        cluster: syntheticCluster,
        diff,
        fixAgent: agentName,
        timeoutMs: options.timeoutMs,
        models: options.models,
        reviewers: options.reviewers,
        verbose: options.verbose,
        fixerContext,
        repoContext,
      });
      validation = valResult;
      if (valResult.reviewer !== "none") {
        const reviewerModel = valResult.reviewer.includes(":") ? undefined : resolveModel(valResult.reviewer, options.models);
        reviewerInfo = { name: valResult.reviewer, model: reviewerModel };
      }
    }

    await commitFix(worktreePath, buildGroupCommitMessage(
      clusters, agentName, resolveModel(agentName, options.models), options.scanModels, reviewerInfo,
    ));

    // Build result items — all share the same branch, diff, and validation
    const items: ParallelFixItemResult[] = clusters.map((c) => ({
      clusterId: c.id, file: c.file, agent: agentName, branch, worktreePath,
      status: "applied" as const, filesChanged, durationMs: Date.now() - startMs, diff,
      fixerContext, manualActions, validation,
    }));

    // Confirmation — the group is kept or discarded as a unit
    const keptBranches: string[] = [];

    if (options.auto) {
      if (validation?.verdict === "concern") {
        for (const c of clusters) {
          await recordDiscardedFix(fixLogRoot, buildDiscardedEntry(
            c.id, c, agentName, diff, validation, "auto-concern",
          ));
        }
        await removeFixWorktree(absRepoPath, worktreePath, branch, true);
      } else {
        for (const c of clusters) {
          await recordFix(fixLogRoot, {
            clusterId: c.id, file: c.file, agent: agentName, branch,
            fixedAt: new Date().toISOString(),
            line: c.line, severity: c.severity, category: c.category,
            rationale: c.rationales[0]?.rationale, diff,
          });
        }
        await removeFixWorktree(absRepoPath, worktreePath, branch, false);
        keptBranches.push(branch);
      }
    } else if (options.onConfirm) {
      // Interactive: confirm once for the group using the first item
      const action = await options.onConfirm(items[0]!, clusters[0]!, 1, clusters.length);

      if (action === "keep") {
        for (const c of clusters) {
          await recordFix(fixLogRoot, {
            clusterId: c.id, file: c.file, agent: agentName, branch,
            fixedAt: new Date().toISOString(),
            line: c.line, severity: c.severity, category: c.category,
            rationale: c.rationales[0]?.rationale, diff,
          });
        }
        await removeFixWorktree(absRepoPath, worktreePath, branch, false);
        keptBranches.push(branch);
      } else {
        // Discard (or retry request — not supported for groups, treat as discard)
        for (const c of clusters) {
          await recordDiscardedFix(fixLogRoot, buildDiscardedEntry(
            c.id, c, agentName, diff, validation, "user-discard",
          ));
        }
        await removeFixWorktree(absRepoPath, worktreePath, branch, true);
      }
    }

    for (const c of clusters) {
      notify({ current: 1, total: clusters.length, clusterId: c.id, file, step: "applied", agent: agentName, branch, filesChanged });
    }

    await cleanupWorktreeBase();
    return makeGroupResult(items, keptBranches, startMs);
  } catch (err) {
    await removeFixWorktree(absRepoPath, worktreePath, branch, true).catch(() => {});
    const items: ParallelFixItemResult[] = clusters.map((c) => ({
      clusterId: c.id, file: c.file, agent: agentName, branch, worktreePath,
      status: "agent-error" as const, filesChanged: 0, durationMs: Date.now() - startMs, diff: "",
      error: `Unexpected error: ${String(err)}`,
    }));
    return makeGroupResult(items, [], startMs);
  }
}

function makeGroupResult(
  items: ParallelFixItemResult[],
  keptBranches: string[],
  startMs: number,
): ParallelFixResult {
  return {
    items,
    keptBranches,
    totalApplied: items.filter((i) => i.status === "applied").length,
    totalSkipped: items.filter((i) => i.status === "skipped" || i.status === "no-changes").length,
    totalFailed: items.filter((i) => i.status === "agent-error").length,
    totalKept: keptBranches.length > 0 ? items.filter((i) => i.status === "applied").length : 0,
    totalDiscarded: keptBranches.length === 0 ? items.filter((i) => i.status === "applied").length : 0,
    totalDurationMs: Date.now() - startMs,
  };
}
