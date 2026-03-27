export {
  ensureCleanWorkTree,
  getCurrentBranch,
  createFixBranch,
  captureDiff,
  commitFix,
  resetLastCommit,
  discardFixBranch,
  keepFixBranch,
  type BranchResult,
} from "./manager.js";

export {
  createFixWorktree,
  removeFixWorktree,
  pruneStaleWorktrees,
  cleanupWorktreeBase,
  getWorktreeBasePath,
} from "./worktree.js";
