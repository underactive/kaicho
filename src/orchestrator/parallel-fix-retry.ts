import type { AgentAdapter } from "../types/index.js";
import type { SuggestionCluster } from "../dedup/index.js";
import { buildRetryFixPrompt, extractFixerContext } from "../prompts/index.js";
import { buildCommitMessage } from "./commit-message.js";
import { captureDiff, commitFix, resetLastCommit } from "../branch/index.js";
import { log } from "../logger/index.js";
import type { ParallelFixItemResult } from "./run-parallel-fix.js";

export interface ParallelRetryContext {
  reviewer: string;
  reviewerModel?: string;
  scanModels?: Record<string, string>;
  concern: string;
  adapter: AgentAdapter;
  worktreePath: string;
  baseBranch: string;
  cluster: SuggestionCluster;
  originalAgent: string;
  originalDiff: string;
  fixStartMs: number;
}

export interface ParallelRetryOutcome {
  item: ParallelFixItemResult;
  applied: boolean;
}

/**
 * Execute a retry fix within an existing worktree.
 * Resets the failed commit, runs the reviewer agent, re-commits.
 */
export async function executeParallelRetry(ctx: ParallelRetryContext): Promise<ParallelRetryOutcome> {
  await resetLastCommit(ctx.worktreePath);

  const retryPrompt = buildRetryFixPrompt(ctx.cluster, ctx.originalDiff, ctx.concern);
  log("info", "Parallel retry fix", { reviewer: ctx.reviewer, cluster: ctx.cluster.id });

  const result = await ctx.adapter.run(ctx.worktreePath, retryPrompt, "fix");

  const base: Omit<ParallelFixItemResult, "status" | "filesChanged" | "diff" | "fixerContext"> = {
    clusterId: ctx.cluster.id,
    file: ctx.cluster.file,
    agent: ctx.reviewer,
    branch: "", // Will be set by caller (same branch as original)
    worktreePath: ctx.worktreePath,
    durationMs: Date.now() - ctx.fixStartMs,
    retryOf: ctx.originalAgent,
  };

  if (result.status !== "success") {
    return {
      item: { ...base, status: "agent-error", filesChanged: 0, diff: "", error: result.error ?? result.status },
      applied: false,
    };
  }

  const retryDiff = await captureDiff(ctx.worktreePath, ctx.baseBranch);

  if (retryDiff.filesChanged === 0) {
    return {
      item: { ...base, status: "no-changes", filesChanged: 0, diff: "" },
      applied: false,
    };
  }

  await commitFix(ctx.worktreePath, buildCommitMessage(ctx.cluster, ctx.reviewer, ctx.reviewerModel, ctx.scanModels));

  return {
    item: {
      ...base,
      status: "applied",
      filesChanged: retryDiff.filesChanged,
      diff: retryDiff.diff,
      fixerContext: extractFixerContext(result.rawOutput) ?? undefined,
    },
    applied: true,
  };
}
