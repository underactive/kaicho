import type { AgentAdapter } from "../types/index.js";
import type { SuggestionCluster } from "../dedup/index.js";
import { buildRetryFixPrompt, extractFixerContext } from "../prompts/index.js";
import { buildCommitMessage } from "./commit-message.js";
import { captureDiff, commitFix, resetLastCommit } from "../branch/index.js";
import { recordFix } from "../fix-log/index.js";
import { log } from "../logger/index.js";
import type { BatchFixItemResult, BatchFixProgress } from "./run-batch-fix.js";

export interface RetryContext {
  reviewer: string;
  reviewerModel?: string;
  scanModels?: Record<string, string>;
  concern: string;
  adapter: AgentAdapter;
  repoPath: string;
  previousBranch: string;
  branch: string;
  cluster: SuggestionCluster;
  originalAgent: string;
  originalDiff: string;
  fixStartMs: number;
  index: number;
  total: number;
  notify: (progress: BatchFixProgress) => void;
}

export interface RetryOutcome {
  item: BatchFixItemResult;
  applied: boolean;
}

/**
 * Execute a retry fix: revert the failed commit, run the reviewer agent
 * with the failed diff and concern as context, commit the result.
 */
export async function executeRetry(ctx: RetryContext): Promise<RetryOutcome> {
  await resetLastCommit(ctx.repoPath);

  const retryPrompt = buildRetryFixPrompt(ctx.cluster, ctx.originalDiff, ctx.concern);
  log("info", "Retry fix", { reviewer: ctx.reviewer, cluster: ctx.cluster.id });

  const result = await ctx.adapter.run(ctx.repoPath, retryPrompt, "fix");

  if (result.status !== "success") {
    const item: BatchFixItemResult = {
      clusterId: ctx.cluster.id,
      file: ctx.cluster.file,
      agent: ctx.reviewer,
      status: "agent-error",
      filesChanged: 0,
      durationMs: Date.now() - ctx.fixStartMs,
      diff: "",
      error: result.error ?? result.status,
      retryOf: ctx.originalAgent,
    };
    ctx.notify({ current: ctx.index, total: ctx.total, clusterId: ctx.cluster.id, file: ctx.cluster.file, step: "failed", error: item.error });
    return { item, applied: false };
  }

  const retryDiff = await captureDiff(ctx.repoPath, ctx.previousBranch);

  if (retryDiff.filesChanged === 0) {
    const item: BatchFixItemResult = {
      clusterId: ctx.cluster.id,
      file: ctx.cluster.file,
      agent: ctx.reviewer,
      status: "no-changes",
      filesChanged: 0,
      durationMs: Date.now() - ctx.fixStartMs,
      diff: "",
      retryOf: ctx.originalAgent,
    };
    ctx.notify({ current: ctx.index, total: ctx.total, clusterId: ctx.cluster.id, file: ctx.cluster.file, step: "no-changes" });
    return { item, applied: false };
  }

  await commitFix(ctx.repoPath, buildCommitMessage(ctx.cluster, ctx.reviewer, ctx.reviewerModel, ctx.scanModels));

  await recordFix(ctx.repoPath, {
    clusterId: ctx.cluster.id,
    file: ctx.cluster.file,
    agent: ctx.reviewer,
    branch: ctx.branch,
    fixedAt: new Date().toISOString(),
    line: ctx.cluster.line,
    severity: ctx.cluster.severity,
    category: ctx.cluster.category,
    rationale: ctx.cluster.rationales[0]?.rationale,
    diff: retryDiff.diff,
  });

  const item: BatchFixItemResult = {
    clusterId: ctx.cluster.id,
    file: ctx.cluster.file,
    agent: ctx.reviewer,
    status: "applied",
    filesChanged: retryDiff.filesChanged,
    durationMs: Date.now() - ctx.fixStartMs,
    diff: retryDiff.diff,
    retryOf: ctx.originalAgent,
    fixerContext: extractFixerContext(result.rawOutput) ?? undefined,
  };

  ctx.notify({
    current: ctx.index,
    total: ctx.total,
    clusterId: ctx.cluster.id,
    file: ctx.cluster.file,
    step: "applied",
    agent: ctx.reviewer,
    filesChanged: retryDiff.filesChanged,
  });

  return { item, applied: true };
}
