import * as os from "node:os";
import * as path from "node:path";
import type { SuggestionCluster } from "../dedup/index.js";
import { buildFixPrompt, extractFixerContext } from "../prompts/index.js";
import { buildCommitMessage } from "./commit-message.js";
import { resolveAdapter } from "./resolve-adapter.js";
import { executeParallelRetry } from "./parallel-fix-retry.js";
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
import { recordFix } from "../fix-log/index.js";
import { log } from "../logger/index.js";

export interface ParallelFixItemResult {
  clusterId: string;
  file: string;
  agent: string;
  branch: string;
  worktreePath: string;
  status: "applied" | "no-changes" | "agent-error" | "skipped";
  filesChanged: number;
  durationMs: number;
  diff: string;
  error?: string;
  retryOf?: string;
  fixerContext?: string;
}

export interface ParallelFixResult {
  items: ParallelFixItemResult[];
  keptBranches: string[];
  totalApplied: number;
  totalSkipped: number;
  totalFailed: number;
  totalKept: number;
  totalDiscarded: number;
  totalDurationMs: number;
}

export interface ParallelFixProgress {
  current: number;
  total: number;
  clusterId: string;
  file: string;
  step: "creating-worktree" | "running-agent" | "applied" | "no-changes" | "failed" | "skipped" | "cleaning-up" | "done";
  agent?: string;
  branch?: string;
  filesChanged?: number;
  error?: string;
  summary?: string;
}

export type ParallelFixItemAction = "keep" | "discard";

export interface ParallelFixRetryAction {
  action: "retry";
  reviewer: string;
  concern: string;
}

export type ParallelFixConfirmResult = ParallelFixItemAction | ParallelFixRetryAction;

export interface ParallelFixOptions {
  repoPath: string;
  clusters: SuggestionCluster[];
  agent?: string;
  timeoutMs?: number;
  models?: Record<string, string>;
  concurrency?: number;
  auto?: boolean;
  verbose?: boolean;
  onProgress?: (progress: ParallelFixProgress) => void;
  onConfirm?: (
    item: ParallelFixItemResult,
    cluster: SuggestionCluster,
    current: number,
    total: number,
  ) => Promise<ParallelFixConfirmResult>;
}

function pickAgent(cluster: SuggestionCluster, override?: string): string {
  if (override) return override;
  return cluster.agents[0] ?? "claude";
}

function makeResult(
  cluster: SuggestionCluster, agent: string, branch: string, worktreePath: string,
  startMs: number, overrides: Partial<ParallelFixItemResult>,
): ParallelFixItemResult {
  return {
    clusterId: cluster.id, file: cluster.file, agent, branch, worktreePath,
    status: "agent-error", filesChanged: 0, durationMs: Date.now() - startMs, diff: "",
    ...overrides,
  };
}

async function executeFixInWorktree(
  cluster: SuggestionCluster, index: number, total: number,
  absRepoPath: string, baseBranch: string,
  options: ParallelFixOptions, notify: (p: ParallelFixProgress) => void,
): Promise<ParallelFixItemResult> {
  const agentName = pickAgent(cluster, options.agent);
  const fixStartMs = Date.now();
  const n = (step: ParallelFixProgress["step"], extra?: Partial<ParallelFixProgress>) =>
    notify({ current: index + 1, total, clusterId: cluster.id, file: cluster.file, step, ...extra });

  n("creating-worktree", { agent: agentName, summary: cluster.summary ?? undefined });

  let worktreePath: string;
  let branch: string;
  try {
    const wt = await createFixWorktree(absRepoPath);
    worktreePath = wt.worktreePath;
    branch = wt.branch;
  } catch (err) {
    return makeResult(cluster, agentName, "", "", fixStartMs, { error: `Failed to create worktree: ${String(err)}` });
  }

  try {
    const adapter = resolveAdapter(agentName, options.timeoutMs, options.models?.[agentName], options.verbose);
    if (!(await adapter.isAvailable())) {
      await removeFixWorktree(absRepoPath, worktreePath, branch, true);
      return makeResult(cluster, agentName, branch, worktreePath, fixStartMs, { error: `Agent "${agentName}" not installed` });
    }

    n("running-agent", { agent: agentName, branch });
    const prompt = buildFixPrompt(cluster);
    log("info", "Parallel fix", { agent: agentName, cluster: `${cluster.file}:${cluster.line}`, branch });

    const result = await adapter.run(worktreePath, prompt, "fix");

    if (result.status !== "success") {
      await removeFixWorktree(absRepoPath, worktreePath, branch, true);
      n("failed", { error: result.error ?? result.status });
      return makeResult(cluster, agentName, branch, worktreePath, fixStartMs, { error: result.error ?? result.status });
    }

    const { diff, filesChanged } = await captureDiff(worktreePath, baseBranch);

    if (filesChanged === 0) {
      await removeFixWorktree(absRepoPath, worktreePath, branch, true);
      n("no-changes");
      return makeResult(cluster, agentName, branch, worktreePath, fixStartMs, { status: "no-changes" });
    }

    await commitFix(worktreePath, buildCommitMessage(cluster, agentName));
    n("applied", { agent: agentName, branch, filesChanged });

    return makeResult(cluster, agentName, branch, worktreePath, fixStartMs, {
      status: "applied", filesChanged, diff,
      fixerContext: extractFixerContext(result.rawOutput) ?? undefined,
    });
  } catch (err) {
    await removeFixWorktree(absRepoPath, worktreePath, branch, true).catch(() => {});
    return makeResult(cluster, agentName, branch, worktreePath, fixStartMs, { error: `Unexpected error: ${String(err)}` });
  }
}

export async function runParallelFix(options: ParallelFixOptions): Promise<ParallelFixResult> {
  const { clusters } = options;
  const expanded = options.repoPath.startsWith("~")
    ? path.join(os.homedir(), options.repoPath.slice(1))
    : options.repoPath;
  const absRepoPath = path.resolve(expanded);
  const notify = options.onProgress ?? (() => {});
  const limit = options.concurrency ?? 3;
  const startMs = Date.now();

  await ensureCleanWorkTree(absRepoPath);
  await pruneStaleWorktrees(absRepoPath);

  const baseBranch = await getCurrentBranch(absRepoPath);
  const results: ParallelFixItemResult[] = [];

  // Parallel execution with concurrency limit
  const pending = new Set<Promise<void>>();
  let clusterIndex = 0;

  while (clusterIndex < clusters.length || pending.size > 0) {
    while (pending.size < limit && clusterIndex < clusters.length) {
      const idx = clusterIndex++;
      const p = executeFixInWorktree(
        clusters[idx]!, idx, clusters.length,
        absRepoPath, baseBranch, options, notify,
      ).then((item) => { results.push(item); })
       .finally(() => { pending.delete(p); });
      pending.add(p);
    }
    if (pending.size > 0) await Promise.race(pending);
  }

  // Sort results back to original cluster order
  const orderMap = new Map(clusters.map((c, i) => [c.id, i]));
  results.sort((a, b) => (orderMap.get(a.clusterId) ?? 0) - (orderMap.get(b.clusterId) ?? 0));

  // Confirmation phase (sequential)
  const keptBranches: string[] = [];
  let totalKept = 0;
  let totalDiscarded = 0;
  let totalApplied = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let i = 0; i < results.length; i++) {
    const item = results[i]!;

    if (item.status === "applied") {
      totalApplied++;

      if (options.auto) {
        // Auto mode: keep all applied fixes
        await recordFix(absRepoPath, {
          clusterId: item.clusterId, file: item.file,
          agent: item.agent, branch: item.branch,
          fixedAt: new Date().toISOString(),
        });
        await removeFixWorktree(absRepoPath, item.worktreePath, item.branch, false);
        keptBranches.push(item.branch);
        totalKept++;
      } else if (options.onConfirm) {
        const action = await options.onConfirm(item, clusters[orderMap.get(item.clusterId)!]!, i + 1, results.length);

        if (action === "keep") {
          await recordFix(absRepoPath, {
            clusterId: item.clusterId, file: item.file,
            agent: item.agent, branch: item.branch,
            fixedAt: new Date().toISOString(),
          });
          await removeFixWorktree(absRepoPath, item.worktreePath, item.branch, false);
          keptBranches.push(item.branch);
          totalKept++;
        } else if (action === "discard") {
          await removeFixWorktree(absRepoPath, item.worktreePath, item.branch, true);
          totalDiscarded++;
        } else if (typeof action === "object" && action.action === "retry") {
          const retryAdapter = resolveAdapter(action.reviewer, options.timeoutMs, options.models?.[action.reviewer], options.verbose);
          const cluster = clusters[orderMap.get(item.clusterId)!]!;
          const { item: retryItem, applied } = await executeParallelRetry({
            reviewer: action.reviewer,
            concern: action.concern,
            adapter: retryAdapter,
            worktreePath: item.worktreePath,
            baseBranch,
            cluster,
            originalAgent: item.agent,
            originalDiff: item.diff,
            fixStartMs: Date.now(),
          });
          retryItem.branch = item.branch;
          retryItem.worktreePath = item.worktreePath;
          results[i] = retryItem;

          if (applied) {
            // Re-confirm without retry option (retryOf is set)
            if (options.onConfirm) {
              const retryAction = await options.onConfirm(retryItem, cluster, i + 1, results.length);
              if (retryAction === "keep") {
                await recordFix(absRepoPath, {
                  clusterId: retryItem.clusterId, file: retryItem.file,
                  agent: retryItem.agent, branch: retryItem.branch,
                  fixedAt: new Date().toISOString(),
                });
                await removeFixWorktree(absRepoPath, item.worktreePath, item.branch, false);
                keptBranches.push(item.branch);
                totalKept++;
              } else {
                await removeFixWorktree(absRepoPath, item.worktreePath, item.branch, true);
                totalDiscarded++;
              }
            }
          } else {
            await removeFixWorktree(absRepoPath, item.worktreePath, item.branch, true);
            totalDiscarded++;
          }
        }
      }
    } else if (item.status === "agent-error") {
      totalFailed++;
    } else {
      totalSkipped++;
    }
  }

  notify({ current: clusters.length, total: clusters.length, clusterId: "", file: "", step: "done" });

  await cleanupWorktreeBase();

  return {
    items: results,
    keptBranches,
    totalApplied,
    totalSkipped,
    totalFailed,
    totalKept,
    totalDiscarded,
    totalDurationMs: Date.now() - startMs,
  };
}
