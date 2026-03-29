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
  getChangedFiles,
  revertMergeCommit,
  type BranchResult,
} from "./manager.js";

export {
  createFixWorktree,
  removeFixWorktree,
  pruneStaleWorktrees,
  cleanupWorktreeBase,
  getWorktreeBasePath,
} from "./worktree.js";
