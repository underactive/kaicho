import * as os from "node:os";
import * as path from "node:path";
import type { AgentAdapter, RunResult } from "../types/index.js";
import {
  ClaudeAdapter,
  CodexAdapter,
  CursorAdapter,
  GeminiAdapter,
} from "../agent-adapters/index.js";
import { AGENT_CONFIGS } from "../config/index.js";
import type { SuggestionCluster } from "../dedup/index.js";
import { buildFixPrompt } from "../prompts/index.js";
import { buildCommitMessage } from "./commit-message.js";
import {
  ensureCleanWorkTree,
  createFixBranch,
  captureDiff,
  commitFix,
  discardFixBranch,
  keepFixBranch,
} from "../branch/index.js";
import { recordFix } from "../fix-log/index.js";
import { log } from "../logger/index.js";

export interface FixProgress {
  step: "check-worktree" | "create-branch" | "check-agent" | "running-agent" | "capture-diff" | "commit" | "done";
  agent?: string;
  branch?: string;
  detail?: string;
}

export interface FixOptions {
  repoPath: string;
  cluster: SuggestionCluster;
  agent?: string;
  timeoutMs?: number;
  onProgress?: (progress: FixProgress) => void;
}

export interface FixResult {
  status: "applied" | "no-changes" | "agent-error" | "dirty-worktree";
  agent: string;
  branch: string;
  previousBranch: string;
  diff: string;
  filesChanged: number;
  durationMs: number;
  error?: string;
}

const ALL_AGENT_NAMES = Object.keys(AGENT_CONFIGS);

function resolveAdapter(agent: string, timeoutMs?: number): AgentAdapter {
  const opts = timeoutMs ? { timeoutMs } : undefined;
  switch (agent) {
    case "claude":
      return new ClaudeAdapter(opts);
    case "codex":
      return new CodexAdapter(opts);
    case "cursor":
      return new CursorAdapter(opts);
    case "gemini":
      return new GeminiAdapter(opts);
    default:
      throw new Error(
        `Unknown agent: ${agent}. Available: ${ALL_AGENT_NAMES.join(", ")}`,
      );
  }
}

/**
 * Pick the best agent for fixing: default to the first agent that found
 * the issue, or the user's override.
 */
function pickAgent(cluster: SuggestionCluster, override?: string): string {
  if (override) return override;
  return cluster.agents[0] ?? "claude";
}

export async function runFix(options: FixOptions): Promise<FixResult> {
  const { cluster, timeoutMs } = options;
  const expanded = options.repoPath.startsWith("~")
    ? path.join(os.homedir(), options.repoPath.slice(1))
    : options.repoPath;
  const absRepoPath = path.resolve(expanded);

  const agentName = pickAgent(cluster, options.agent);
  const notify = options.onProgress ?? (() => {});
  const startMs = Date.now();

  // Check for clean working tree
  notify({ step: "check-worktree" });
  try {
    await ensureCleanWorkTree(absRepoPath);
  } catch (err) {
    return {
      status: "dirty-worktree",
      agent: agentName,
      branch: "",
      previousBranch: "",
      diff: "",
      filesChanged: 0,
      durationMs: Date.now() - startMs,
      error: String(err instanceof Error ? err.message : err),
    };
  }

  // Create fix branch
  notify({ step: "create-branch", agent: agentName });
  const { branch, previousBranch } = await createFixBranch(absRepoPath);

  try {
    notify({ step: "check-agent", agent: agentName, branch });
    const adapter = resolveAdapter(agentName, timeoutMs);

    const available = await adapter.isAvailable();
    if (!available) {
      await discardFixBranch(absRepoPath, branch, previousBranch);
      return {
        status: "agent-error",
        agent: agentName,
        branch,
        previousBranch,
        diff: "",
        filesChanged: 0,
        durationMs: Date.now() - startMs,
        error: `Agent "${agentName}" CLI not found in PATH`,
      };
    }

    const prompt = buildFixPrompt(cluster);
    log("info", "Running fix", { agent: agentName, branch, cluster: `${cluster.file}:${cluster.line}` });
    notify({ step: "running-agent", agent: agentName, branch, detail: `${cluster.file}:${cluster.line}` });

    const result = await adapter.run(absRepoPath, prompt, "fix");

    if (result.status !== "success") {
      await discardFixBranch(absRepoPath, branch, previousBranch);
      return {
        status: "agent-error",
        agent: agentName,
        branch,
        previousBranch,
        diff: "",
        filesChanged: 0,
        durationMs: Date.now() - startMs,
        error: result.error ?? result.status,
      };
    }

    // Capture what changed
    notify({ step: "capture-diff", agent: agentName, branch });
    const { diff, filesChanged } = await captureDiff(absRepoPath, previousBranch);

    if (filesChanged === 0) {
      await discardFixBranch(absRepoPath, branch, previousBranch);
      return {
        status: "no-changes",
        agent: agentName,
        branch,
        previousBranch,
        diff: "",
        filesChanged: 0,
        durationMs: Date.now() - startMs,
      };
    }

    // Commit the fix
    notify({ step: "commit", agent: agentName, branch, detail: `${filesChanged} file${filesChanged === 1 ? "" : "s"}` });
    await commitFix(absRepoPath, buildCommitMessage(cluster, agentName));

    await recordFix(absRepoPath, {
      clusterId: cluster.id,
      file: cluster.file,
      agent: agentName,
      branch,
      fixedAt: new Date().toISOString(),
    });

    notify({ step: "done", agent: agentName, branch, detail: `${filesChanged} file${filesChanged === 1 ? "" : "s"} changed` });

    return {
      status: "applied",
      agent: agentName,
      branch,
      previousBranch,
      diff,
      filesChanged,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    // Best-effort cleanup
    try {
      await discardFixBranch(absRepoPath, branch, previousBranch);
    } catch {
      log("warn", "Failed to clean up fix branch", { branch });
    }

    return {
      status: "agent-error",
      agent: agentName,
      branch,
      previousBranch,
      diff: "",
      filesChanged: 0,
      durationMs: Date.now() - startMs,
      error: `Unexpected error: ${String(err)}`,
    };
  }
}

/**
 * After reviewing a fix, the user can keep or discard the branch.
 */
export async function resolveFixBranch(
  repoPath: string,
  branch: string,
  previousBranch: string,
  action: "keep" | "discard",
): Promise<void> {
  const expanded = repoPath.startsWith("~")
    ? path.join(os.homedir(), repoPath.slice(1))
    : repoPath;
  const absRepoPath = path.resolve(expanded);

  if (action === "discard") {
    await discardFixBranch(absRepoPath, branch, previousBranch);
  } else {
    await keepFixBranch(absRepoPath, previousBranch);
  }
}
