import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SuggestionCluster } from "../dedup/index.js";

const {
  mockRunParallelFix, mockMergeBranch, mockGetChangedFiles,
  mockEnsureClean, mockGetCurrentBranch, mockCreateWorktree,
  mockRemoveWorktree, mockPruneWorktrees, mockCleanupBase,
  mockCaptureDiff, mockCommitFix, mockRecordFix, mockRecordDiscardedFix,
  mockIsAvailable, mockAdapterRun, mockResetLastCommit,
} = vi.hoisted(() => ({
  mockRunParallelFix: vi.fn(),
  mockMergeBranch: vi.fn().mockResolvedValue(undefined),
  mockGetChangedFiles: vi.fn().mockResolvedValue([]),
  mockEnsureClean: vi.fn().mockResolvedValue(undefined),
  mockGetCurrentBranch: vi.fn().mockResolvedValue("main"),
  mockCreateWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/wt", branch: "kaicho/fix-test" }),
  mockRemoveWorktree: vi.fn().mockResolvedValue(undefined),
  mockPruneWorktrees: vi.fn().mockResolvedValue(undefined),
  mockCleanupBase: vi.fn().mockResolvedValue(undefined),
  mockCaptureDiff: vi.fn().mockResolvedValue({ diff: "", filesChanged: 0 }),
  mockCommitFix: vi.fn().mockResolvedValue(undefined),
  mockRecordFix: vi.fn().mockResolvedValue(undefined),
  mockRecordDiscardedFix: vi.fn().mockResolvedValue(undefined),
  mockIsAvailable: vi.fn().mockResolvedValue(true),
  mockAdapterRun: vi.fn().mockResolvedValue({
    agent: "claude", status: "success", suggestions: [],
    rawOutput: "", rawError: "", durationMs: 100, startedAt: new Date().toISOString(),
  }),
  mockResetLastCommit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./run-parallel-fix.js", () => ({
  runParallelFix: mockRunParallelFix,
}));

vi.mock("../branch/index.js", () => ({
  mergeBranch: mockMergeBranch,
  getChangedFiles: mockGetChangedFiles,
  ensureCleanWorkTree: mockEnsureClean,
  getCurrentBranch: mockGetCurrentBranch,
  createFixWorktree: mockCreateWorktree,
  removeFixWorktree: mockRemoveWorktree,
  pruneStaleWorktrees: mockPruneWorktrees,
  cleanupWorktreeBase: mockCleanupBase,
  captureDiff: mockCaptureDiff,
  commitFix: mockCommitFix,
  resetLastCommit: mockResetLastCommit,
}));

vi.mock("../fix-log/index.js", () => ({
  recordFix: mockRecordFix,
  recordDiscardedFix: mockRecordDiscardedFix,
}));

vi.mock("../repo-context/index.js", () => ({
  fingerprint: vi.fn().mockResolvedValue({
    languages: [], frameworks: [], testRunners: [], linters: [],
    entryPoints: [], packageManager: null, monorepoTool: null, architectureDocs: [], workspacePackages: [], languageDistribution: [], components: [],
  }),
  formatRepoContext: vi.fn().mockReturnValue(""),
}));

import { runBatchedFix } from "./batched-fix.js";

function makeCluster(id: string, file: string): SuggestionCluster {
  return {
    id, file, line: 10, category: "security", severity: "high",
    agents: ["claude"], agreement: 1, items: [],
    rationales: [{ agent: "claude", rationale: "test" }],
    suggestedChange: null,
  };
}

function makeParallelResult(keptBranches: string[] = []) {
  return {
    items: keptBranches.map((b) => ({
      clusterId: b, file: "test.ts", agent: "claude", branch: b,
      worktreePath: "/tmp", status: "applied" as const,
      filesChanged: 1, durationMs: 100, diff: "diff",
    })),
    keptBranches,
    totalApplied: keptBranches.length,
    totalSkipped: 0,
    totalFailed: 0,
    totalKept: keptBranches.length,
    totalDiscarded: 0,
    totalDurationMs: 100,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRunParallelFix.mockResolvedValue(makeParallelResult());
  mockGetChangedFiles.mockResolvedValue([]);
});

describe("runBatchedFix", () => {
  it("runs all disjoint clusters in one batch", async () => {
    const clusters = [
      makeCluster("a", "src/a.ts"),
      makeCluster("b", "src/b.ts"),
      makeCluster("c", "src/c.ts"),
    ];

    mockRunParallelFix.mockResolvedValue(makeParallelResult(["br-a", "br-b", "br-c"]));

    const result = await runBatchedFix({ repoPath: "/repo", clusters, auto: true });

    // One batch with all 3
    expect(mockRunParallelFix).toHaveBeenCalledTimes(1);
    const passedClusters = mockRunParallelFix.mock.calls[0]![0].clusters;
    expect(passedClusters).toHaveLength(3);
    expect(result.totalKept).toBe(3);
  });

  it("serializes clusters on the same file into separate batches", async () => {
    const clusters = [
      makeCluster("a1", "src/a.ts"),
      makeCluster("a2", "src/a.ts"),
      makeCluster("a3", "src/a.ts"),
    ];

    mockRunParallelFix.mockResolvedValue(makeParallelResult(["br"]));

    await runBatchedFix({ repoPath: "/repo", clusters, auto: true });

    // Should be 3 batches of 1 (same file)
    expect(mockRunParallelFix).toHaveBeenCalledTimes(3);
    for (const call of mockRunParallelFix.mock.calls) {
      expect(call[0].clusters).toHaveLength(1);
    }
  });

  it("groups file-disjoint clusters together and defers conflicts", async () => {
    const clusters = [
      makeCluster("a1", "src/a.ts"),
      makeCluster("b1", "src/b.ts"),
      makeCluster("a2", "src/a.ts"),  // conflicts with a1
    ];

    let batchNum = 0;
    mockRunParallelFix.mockImplementation(async () => {
      batchNum++;
      if (batchNum === 1) return makeParallelResult(["br-a1", "br-b1"]);
      return makeParallelResult(["br-a2"]);
    });

    const result = await runBatchedFix({ repoPath: "/repo", clusters, auto: true });

    expect(mockRunParallelFix).toHaveBeenCalledTimes(2);
    // Batch 1: a1 + b1 (disjoint)
    expect(mockRunParallelFix.mock.calls[0]![0].clusters).toHaveLength(2);
    // Batch 2: a2 (deferred)
    expect(mockRunParallelFix.mock.calls[1]![0].clusters).toHaveLength(1);
    expect(result.totalKept).toBe(3);
  });

  it("uses informed grouping — defers clusters on secondarily-touched files", async () => {
    const clusters = [
      makeCluster("a1", "src/a.ts"),
      makeCluster("b1", "src/b.ts"),
    ];

    // Fix for a1 also touches src/b.ts (secondary file)
    mockRunParallelFix
      .mockResolvedValueOnce(makeParallelResult(["br-a1"]))
      .mockResolvedValueOnce(makeParallelResult(["br-b1"]));

    mockGetChangedFiles.mockResolvedValueOnce(["src/a.ts", "src/b.ts"]);

    const result = await runBatchedFix({ repoPath: "/repo", clusters, auto: true, concurrency: 1 });

    // With concurrency 1: batch 1 = a1, batch 2 = b1
    // But even with higher concurrency, b1 would be deferred after
    // merge reveals a1 touched src/b.ts
    expect(mockRunParallelFix).toHaveBeenCalledTimes(2);
    expect(result.totalKept).toBe(2);
  });

  it("respects concurrency cap", async () => {
    const clusters = [
      makeCluster("a", "src/a.ts"),
      makeCluster("b", "src/b.ts"),
      makeCluster("c", "src/c.ts"),
      makeCluster("d", "src/d.ts"),
      makeCluster("e", "src/e.ts"),
    ];

    let batchNum = 0;
    mockRunParallelFix.mockImplementation(async (opts: { clusters: SuggestionCluster[] }) => {
      batchNum++;
      const branches = opts.clusters.map((c: SuggestionCluster) => `br-${c.id}`);
      return makeParallelResult(branches);
    });

    await runBatchedFix({ repoPath: "/repo", clusters, auto: true, concurrency: 3 });

    // Batch 1: 3 clusters, Batch 2: 2 clusters
    expect(mockRunParallelFix).toHaveBeenCalledTimes(2);
    expect(mockRunParallelFix.mock.calls[0]![0].clusters).toHaveLength(3);
    expect(mockRunParallelFix.mock.calls[1]![0].clusters).toHaveLength(2);
  });

  it("handles merge failure gracefully", async () => {
    const clusters = [makeCluster("a", "src/a.ts")];
    mockRunParallelFix.mockResolvedValue(makeParallelResult(["br-a"]));
    mockMergeBranch.mockRejectedValue(new Error("merge conflict"));

    const result = await runBatchedFix({ repoPath: "/repo", clusters, auto: true });

    // Merge failed but didn't crash
    expect(result.keptBranches).toEqual([]);
    expect(result.totalKept).toBe(0);
  });

  it("returns empty result for empty clusters", async () => {
    const result = await runBatchedFix({ repoPath: "/repo", clusters: [], auto: true });

    expect(result.items).toEqual([]);
    expect(result.keptBranches).toEqual([]);
    expect(mockRunParallelFix).not.toHaveBeenCalled();
  });
});
