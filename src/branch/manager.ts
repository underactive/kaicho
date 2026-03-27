import { execa } from "execa";
import { randomBytes } from "node:crypto";
import { log } from "../logger/index.js";

const BRANCH_PREFIX = "kaicho/fix-";

export interface BranchResult {
  branch: string;
  previousBranch: string;
  diff: string;
  filesChanged: number;
}

/**
 * Check that the working tree is clean (no uncommitted changes).
 * Refuses to run fix on a dirty tree to avoid mixing changes.
 */
export async function ensureCleanWorkTree(repoPath: string): Promise<void> {
  const result = await execa("git", ["status", "--porcelain"], {
    cwd: repoPath,
    reject: false,
  });

  if (result.stdout.trim()) {
    throw new Error(
      "Working tree has uncommitted changes. Commit or stash them before running fix.",
    );
  }
}

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  const result = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoPath,
  });
  return result.stdout.trim();
}

/**
 * Create a new branch for the fix and switch to it.
 */
export async function createFixBranch(repoPath: string): Promise<{
  branch: string;
  previousBranch: string;
}> {
  const previousBranch = await getCurrentBranch(repoPath);
  const shortHash = randomBytes(4).toString("hex");
  const branch = `${BRANCH_PREFIX}${shortHash}`;

  await execa("git", ["checkout", "-b", branch], {
    cwd: repoPath,
  });

  log("info", "Created fix branch", { branch, from: previousBranch });

  return { branch, previousBranch };
}

/**
 * Capture the diff of changes made on the fix branch.
 */
export async function captureDiff(repoPath: string, baseBranch: string): Promise<{
  diff: string;
  filesChanged: number;
}> {
  // Stage all changes so diff picks them up
  await execa("git", ["add", "-A"], { cwd: repoPath });

  const diffResult = await execa(
    "git",
    ["diff", "--cached", "--stat"],
    { cwd: repoPath },
  );

  const fullDiff = await execa(
    "git",
    ["diff", "--cached"],
    { cwd: repoPath },
  );

  const filesChanged = diffResult.stdout
    .trim()
    .split("\n")
    .filter((l) => l.includes("|"))
    .length;

  return {
    diff: fullDiff.stdout,
    filesChanged,
  };
}

/**
 * Commit the fix changes on the current branch.
 */
export async function commitFix(
  repoPath: string,
  message: string,
): Promise<void> {
  await execa("git", ["add", "-A"], { cwd: repoPath });
  await execa("git", ["commit", "-m", message], {
    cwd: repoPath,
    reject: false,
  });
}

/**
 * Switch back to the previous branch. Optionally delete the fix branch.
 */
export async function discardFixBranch(
  repoPath: string,
  fixBranch: string,
  previousBranch: string,
): Promise<void> {
  await execa("git", ["checkout", previousBranch], { cwd: repoPath });
  await execa("git", ["branch", "-D", fixBranch], {
    cwd: repoPath,
    reject: false,
  });
  log("info", "Discarded fix branch", { branch: fixBranch });
}

/**
 * Switch back to the previous branch, keeping the fix branch.
 */
export async function keepFixBranch(
  repoPath: string,
  previousBranch: string,
): Promise<void> {
  await execa("git", ["checkout", previousBranch], { cwd: repoPath });
}
