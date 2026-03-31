import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execa } from "execa";
import { randomBytes } from "node:crypto";
import { log } from "../logger/index.js";

const BRANCH_PREFIX = "kaicho/fix-";
const SWEEP_BRANCH_PREFIX = "kaicho/sweep-";

/**
 * Base path for worktree directories, grouped by PID for easy cleanup.
 */
export function getWorktreeBasePath(): string {
  return path.join(os.tmpdir(), `kaicho-wt-${process.pid}`);
}

/**
 * Prune stale worktrees left behind by crashed sessions.
 */
export async function pruneStaleWorktrees(repoPath: string): Promise<void> {
  await execa("git", ["worktree", "prune"], { cwd: repoPath, reject: false });
  log("info", "Pruned stale worktrees", { repoPath });
}

/**
 * Create an isolated git worktree with its own branch for a fix.
 * The worktree is created at a temp directory; the main worktree is not touched.
 */
export async function createFixWorktree(repoPath: string): Promise<{
  worktreePath: string;
  branch: string;
}> {
  const shortHash = randomBytes(4).toString("hex");
  const branch = `${BRANCH_PREFIX}${shortHash}`;
  const basePath = getWorktreeBasePath();
  const worktreePath = path.join(basePath, branch.replace("/", "-"));

  await fs.mkdir(basePath, { recursive: true });

  await execa("git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
    cwd: repoPath,
  });

  log("info", "Created fix worktree", { branch, worktreePath });
  return { worktreePath, branch };
}

/**
 * Create an isolated git worktree for a sweep branch.
 * Uses a separate base directory from fix worktrees so that
 * cleanupWorktreeBase() (which nukes the fix base) doesn't destroy it.
 */
export async function createSweepWorktree(repoPath: string): Promise<{
  worktreePath: string;
  branch: string;
}> {
  const shortHash = randomBytes(4).toString("hex");
  const branch = `${SWEEP_BRANCH_PREFIX}${shortHash}`;
  const basePath = path.join(os.tmpdir(), `kaicho-sweep-${process.pid}`);
  const worktreePath = path.join(basePath, branch.replace("/", "-"));

  await fs.mkdir(basePath, { recursive: true });

  await execa("git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
    cwd: repoPath,
  });

  log("info", "Created sweep worktree", { branch, worktreePath });
  return { worktreePath, branch };
}

/**
 * Remove a worktree and optionally delete its branch.
 */
export async function removeFixWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  deleteBranch: boolean,
): Promise<void> {
  await execa("git", ["worktree", "remove", worktreePath, "--force"], {
    cwd: repoPath,
    reject: false,
  });

  if (deleteBranch) {
    await execa("git", ["branch", "-D", branch], {
      cwd: repoPath,
      reject: false,
    });
  }

  log("info", "Removed fix worktree", { branch, deleteBranch });
}

/**
 * Remove the worktree base directory (best-effort cleanup).
 */
export async function cleanupWorktreeBase(): Promise<void> {
  try {
    await fs.rm(getWorktreeBasePath(), { recursive: true, force: true });
  } catch {
    // Best-effort
  }
}

/**
 * Delete orphaned `kaicho/fix-*` branches that have no associated worktree.
 *
 * These accumulate when a merge fails and the deferred retry never runs
 * (e.g. because the layer crashed). Called at the end of a sweep to avoid
 * leaving stale branches in the user's repo.
 */
export async function pruneOrphanFixBranches(repoPath: string): Promise<void> {
  // List all kaicho/fix-* branches
  const { stdout: branchList } = await execa(
    "git", ["branch", "--list", `${BRANCH_PREFIX}*`, "--format=%(refname:short)"],
    { cwd: repoPath, reject: false },
  );
  if (!branchList.trim()) return;

  const branches = branchList.trim().split("\n").filter(Boolean);

  // List active worktree branches so we don't delete branches with live worktrees
  const { stdout: wtList } = await execa(
    "git", ["worktree", "list", "--porcelain"],
    { cwd: repoPath, reject: false },
  );
  const activeBranches = new Set(
    wtList.split("\n")
      .filter((l) => l.startsWith("branch "))
      .map((l) => l.replace("branch refs/heads/", "")),
  );

  const orphans = branches.filter((b) => !activeBranches.has(b));
  if (orphans.length === 0) return;

  for (const branch of orphans) {
    await execa("git", ["branch", "-D", branch], {
      cwd: repoPath,
      reject: false,
    });
  }

  log("info", "Pruned orphan fix branches", {
    removed: orphans.length,
    branches: orphans,
  });
}
