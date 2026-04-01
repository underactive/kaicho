import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface BranchDetail {
  branch: string;
  commitMessage: string;
  diff: string;
  exists: boolean;
  source: "fix-branch" | "sweep-branch" | "not-found";
}

const FIX_BRANCH_RE = /^kaicho\/fix-[a-f0-9]+$/;
const SWEEP_BRANCH_RE = /^kaicho\/sweep-[a-f0-9]+$/;

/**
 * Get the commit message and diff for a fix.
 *
 * Strategy:
 * 1. Try the fix branch directly (if it still exists)
 * 2. Fall back to searching the sweep branch for a commit matching the cluster ID
 */
export async function readBranchDetail(
  repoPath: string,
  branch: string,
  options?: { clusterId?: string; sweepBranch?: string },
): Promise<BranchDetail> {
  // Sanitize branch name
  if (!FIX_BRANCH_RE.test(branch)) {
    return { branch, commitMessage: "", diff: "", exists: false, source: "not-found" };
  }

  // Strategy 1: try the fix branch directly
  const direct = await tryFixBranch(repoPath, branch);
  if (direct) return direct;

  // Strategy 2: search the sweep branch for a commit matching the cluster ID
  if (options?.sweepBranch && options?.clusterId) {
    const fromSweep = await tryFromSweepBranch(repoPath, options.sweepBranch, options.clusterId, branch);
    if (fromSweep) return fromSweep;
  }

  return { branch, commitMessage: "", diff: "", exists: false, source: "not-found" };
}

async function tryFixBranch(repoPath: string, branch: string): Promise<BranchDetail | null> {
  try {
    await exec("git", ["rev-parse", "--verify", branch], { cwd: repoPath });
  } catch {
    return null;
  }

  const commitMessage = await getCommitMessage(repoPath, branch);
  const diff = await getCommitDiff(repoPath, branch);

  return { branch, commitMessage, diff, exists: true, source: "fix-branch" };
}

async function tryFromSweepBranch(
  repoPath: string,
  sweepBranch: string,
  clusterId: string,
  fixBranch: string,
): Promise<BranchDetail | null> {
  if (!SWEEP_BRANCH_RE.test(sweepBranch)) return null;
  // Sanitize cluster ID (should be 6 hex chars)
  if (!/^[a-f0-9]{4,8}$/.test(clusterId)) return null;

  try {
    await exec("git", ["rev-parse", "--verify", sweepBranch], { cwd: repoPath });
  } catch {
    return null;
  }

  // Search the sweep branch for a commit whose message contains the cluster ID
  try {
    const grepResult = await exec(
      "git",
      ["log", sweepBranch, "--all-match", `--grep=Kaichō ref: ${clusterId}`, "--format=%H", "-1"],
      { cwd: repoPath, maxBuffer: 1024 * 1024 },
    );
    const commitHash = grepResult.stdout.trim();
    if (!commitHash) return null;

    const commitMessage = await getCommitMessageByHash(repoPath, commitHash);
    const diff = await getCommitDiffByHash(repoPath, commitHash);

    return { branch: fixBranch, commitMessage, diff, exists: true, source: "sweep-branch" };
  } catch {
    return null;
  }
}

async function getCommitMessage(repoPath: string, ref: string): Promise<string> {
  try {
    const result = await exec("git", ["log", ref, "--format=%B", "-1"], {
      cwd: repoPath,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim();
  } catch {
    return "";
  }
}

async function getCommitMessageByHash(repoPath: string, hash: string): Promise<string> {
  try {
    const result = await exec("git", ["log", hash, "--format=%B", "-1"], {
      cwd: repoPath,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim();
  } catch {
    return "";
  }
}

async function getCommitDiff(repoPath: string, ref: string): Promise<string> {
  try {
    const result = await exec("git", ["diff", `${ref}~1..${ref}`, "--"], {
      cwd: repoPath,
      maxBuffer: 5 * 1024 * 1024,
    });
    return result.stdout;
  } catch {
    try {
      const result = await exec("git", ["show", ref, "--format=", "--patch"], {
        cwd: repoPath,
        maxBuffer: 5 * 1024 * 1024,
      });
      return result.stdout;
    } catch {
      return "";
    }
  }
}

async function getCommitDiffByHash(repoPath: string, hash: string): Promise<string> {
  try {
    const result = await exec("git", ["show", hash, "--format=", "--patch"], {
      cwd: repoPath,
      maxBuffer: 5 * 1024 * 1024,
    });
    return result.stdout;
  } catch {
    return "";
  }
}
