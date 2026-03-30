import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SuggestionCluster } from "../dedup/index.js";
import type { ParallelFixProgress } from "./run-parallel-fix.js";

const {
  mockRunParallelFix, mockMergeBranch, mockAbortMerge, mockGetChangedFiles,
  mockEnsureClean, mockGetCurrentBranch, mockCreateWorktree,
  mockRemoveWorktree, mockPruneWorktrees, mockCleanupBase,
  mockCaptureDiff, mockCommitFix, mockRecordFix, mockRecordDiscardedFix,
  mockIsAvailable, mockAdapterRun, mockResetLastCommit,
} = vi.hoisted(() => ({
  mockRunParallelFix: vi.fn(),
  mockMergeBranch: vi.fn().mockResolvedValue(undefined),
  mockAbortMerge: vi.fn().mockResolvedValue(undefined),
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
  abortMerge: mockAbortMerge,
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

  it("handles merge failure gracefully and aborts the merge", async () => {
    const clusters = [makeCluster("a", "src/a.ts")];
    mockRunParallelFix.mockResolvedValue(makeParallelResult(["br-a"]));
    mockMergeBranch.mockRejectedValue(new Error("merge conflict"));

    const result = await runBatchedFix({ repoPath: "/repo", clusters, auto: true });

    // Merge failed but didn't crash
    expect(result.keptBranches).toEqual([]);
    expect(result.totalKept).toBe(0);
    // Working tree was cleaned up
    expect(mockAbortMerge).toHaveBeenCalledWith("/repo");
  });

  it("defers merge-conflicted clusters for retry in next batch", async () => {
    // Two disjoint files: a.ts and b.ts
    // Fix for b.ts will conflict on merge (agent touched a.ts too)
    const clusters = [
      makeCluster("a", "src/a.ts"),
      makeCluster("b", "src/b.ts"),
    ];

    function makeItemsWithMapping(
      pairs: { clusterId: string; branch: string }[],
    ) {
      return {
        items: pairs.map((p) => ({
          clusterId: p.clusterId, file: "test.ts", agent: "claude",
          branch: p.branch, worktreePath: "/tmp",
          status: "applied" as const, filesChanged: 1, durationMs: 100, diff: "diff",
        })),
        keptBranches: pairs.map((p) => p.branch),
        totalApplied: pairs.length, totalSkipped: 0, totalFailed: 0,
        totalKept: pairs.length, totalDiscarded: 0, totalDurationMs: 100,
      };
    }

    let batchNum = 0;
    mockRunParallelFix.mockImplementation(async () => {
      batchNum++;
      if (batchNum === 1) {
        return makeItemsWithMapping([
          { clusterId: "a", branch: "br-a" },
          { clusterId: "b", branch: "br-b" },
        ]);
      }
      // Retry: only b runs, succeeds this time
      return makeItemsWithMapping([{ clusterId: "b", branch: "br-b-retry" }]);
    });

    // First batch: br-a merges OK, br-b conflicts
    mockMergeBranch
      .mockResolvedValueOnce(undefined)   // br-a OK
      .mockRejectedValueOnce(new Error("merge conflict"))  // br-b conflict
      .mockResolvedValueOnce(undefined);  // br-b-retry OK (after retry)

    mockGetChangedFiles.mockResolvedValue(["src/a.ts"]);

    const result = await runBatchedFix({ repoPath: "/repo", clusters, auto: true });

    // Should have run 2 batches: original + retry
    expect(mockRunParallelFix).toHaveBeenCalledTimes(2);
    // Retry batch should contain only cluster "b"
    expect(mockRunParallelFix.mock.calls[1]![0].clusters).toHaveLength(1);
    expect(mockRunParallelFix.mock.calls[1]![0].clusters[0].id).toBe("b");
    // Both ended up merged
    expect(result.totalKept).toBe(2);
    // Abort was called for the failed merge
    expect(mockAbortMerge).toHaveBeenCalledTimes(1);
  });

  it("returns empty result for empty clusters", async () => {
    const result = await runBatchedFix({ repoPath: "/repo", clusters: [], auto: true });

    expect(result.items).toEqual([]);
    expect(result.keptBranches).toEqual([]);
    expect(mockRunParallelFix).not.toHaveBeenCalled();
  });

  it("gates serial fixes until all parallel batches are exhausted", async () => {
    mockMergeBranch.mockResolvedValue(undefined);

    // 3 disjoint files + 2 that conflict via secondary touches
    const clusters = [
      makeCluster("a", "src/a.ts"),
      makeCluster("b", "src/b.ts"),
      makeCluster("c", "src/c.ts"),
      makeCluster("d", "src/d.ts"), // will conflict after merge reveals a.ts touches d.ts
      makeCluster("e", "src/e.ts"), // will conflict after merge reveals b.ts touches e.ts
    ];

    const batchClusters: string[][] = [];
    mockRunParallelFix.mockImplementation(async (opts: { clusters: SuggestionCluster[] }) => {
      const ids = opts.clusters.map((c: SuggestionCluster) => c.id);
      batchClusters.push(ids);
      return makeParallelResult(ids.map((id) => `br-${id}`));
    });

    // After merging parallel batch, reveal secondary file touches
    mockGetChangedFiles
      .mockResolvedValueOnce(["src/a.ts", "src/d.ts"])  // merge br-a touches d.ts
      .mockResolvedValueOnce(["src/b.ts", "src/e.ts"])  // merge br-b touches e.ts
      .mockResolvedValueOnce(["src/c.ts"])               // merge br-c clean
      .mockResolvedValue([]);                            // serial merges

    await runBatchedFix({ repoPath: "/repo", clusters, auto: true, concurrency: 3 });

    // Phase 1: batch 1 = [a, b, c] (all disjoint)
    // Phase 1 ends: d and e both conflict with touchedFiles
    // Phase 2: batch 2 = [d] (serial), batch 3 = [e] (serial)
    expect(batchClusters[0]).toEqual(["a", "b", "c"]);
    expect(batchClusters[1]).toEqual(["d"]);
    expect(batchClusters[2]).toEqual(["e"]);
    expect(mockRunParallelFix).toHaveBeenCalledTimes(3);
  });

  it("reports global progress across batches", async () => {
    // a1 + b1 = batch 1 (disjoint), a2 conflicts → batch 2
    const clusters = [
      makeCluster("a1", "src/a.ts"),
      makeCluster("b1", "src/b.ts"),
      makeCluster("a2", "src/a.ts"),
    ];

    const events: ParallelFixProgress[] = [];

    mockRunParallelFix.mockImplementation(async (opts: {
      clusters: SuggestionCluster[];
      onProgress?: (p: ParallelFixProgress) => void;
    }) => {
      for (let i = 0; i < opts.clusters.length; i++) {
        opts.onProgress?.({
          current: i + 1, total: opts.clusters.length,
          clusterId: opts.clusters[i]!.id, file: opts.clusters[i]!.file,
          step: "applied",
        });
      }
      // runParallelFix emits a per-batch "done"
      opts.onProgress?.({
        current: opts.clusters.length, total: opts.clusters.length,
        clusterId: "", file: "", step: "done",
      });
      return makeParallelResult(opts.clusters.map((c: SuggestionCluster) => `br-${c.id}`));
    });

    await runBatchedFix({
      repoPath: "/repo", clusters, auto: true,
      onProgress: (p) => events.push({ ...p }),
    });

    const nonDone = events.filter((e) => e.step !== "done");
    // Global total is always 3
    expect(nonDone.every((e) => e.total === 3)).toBe(true);
    // Global current goes 1, 2, 3 (not 1, 2 then 1 again)
    expect(nonDone.map((e) => e.current)).toEqual([1, 2, 3]);

    // Exactly one final "done" (per-batch ones suppressed)
    const doneEvents = events.filter((e) => e.step === "done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]!.current).toBe(3);
    expect(doneEvents[0]!.total).toBe(3);
  });

  it("emits no progress events when onProgress is not provided", async () => {
    const clusters = [makeCluster("a", "src/a.ts")];
    mockRunParallelFix.mockImplementation(async (opts: {
      onProgress?: (p: ParallelFixProgress) => void;
    }) => {
      // Should not crash when onProgress is undefined
      opts.onProgress?.({ current: 1, total: 1, clusterId: "a", file: "src/a.ts", step: "applied" });
      opts.onProgress?.({ current: 1, total: 1, clusterId: "", file: "", step: "done" });
      return makeParallelResult(["br-a"]);
    });

    // No onProgress — should not throw
    await expect(runBatchedFix({ repoPath: "/repo", clusters, auto: true })).resolves.toBeDefined();
  });
});
