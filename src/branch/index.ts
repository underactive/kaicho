export {
  ensureCleanWorkTree,
  getCurrentBranch,
  createFixBranch,
  captureDiff,
  commitFix,
  resetLastCommit,
  discardFixBranch,
  keepFixBranch,
  mergeBranch,
  abortMerge,
  getChangedFiles,
  revertMergeCommit,
  type BranchResult,
} from "./manager.js";

export {
  createFixWorktree,
  createSweepWorktree,
  removeFixWorktree,
  pruneStaleWorktrees,
  cleanupWorktreeBase,
  getWorktreeBasePath,
} from "./worktree.js";
