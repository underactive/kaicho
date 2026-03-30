import { describe, it, expect, vi, beforeEach } from "vitest";
import { SWEEP_LAYERS, DEFAULT_MAX_ROUNDS, countCriticalHigh } from "./sweep-types.js";

const {
  mockRunScan, mockRunBatchedFix,
  mockEnsureClean, mockCreateSweepWorktree, mockRemoveFixWorktree, mockPruneStaleWorktrees, mockExeca,
  mockLoadFixLog, mockWriteSweepReport, mockWriteSweepRegressions,
} = vi.hoisted(() => ({
  mockRunScan: vi.fn(),
  mockRunBatchedFix: vi.fn(),
  mockEnsureClean: vi.fn().mockResolvedValue(undefined),
  mockCreateSweepWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/kaicho-sweep-1234/kaicho-sweep-abc12345", branch: "kaicho/sweep-abc12345" }),
  mockRemoveFixWorktree: vi.fn().mockResolvedValue(undefined),
  mockPruneStaleWorktrees: vi.fn().mockResolvedValue(undefined),
  mockExeca: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
  mockLoadFixLog: vi.fn().mockResolvedValue([]),
  mockWriteSweepReport: vi.fn().mockResolvedValue("/repo/.kaicho/sweep-report.json"),
  mockWriteSweepRegressions: vi.fn().mockResolvedValue("/repo/.kaicho/sweep-regressions.json"),
}));

vi.mock("./run-scan.js", () => ({
  runScan: mockRunScan,
}));

vi.mock("./batched-fix.js", () => ({
  runBatchedFix: mockRunBatchedFix,
}));

vi.mock("execa", () => ({
  execa: mockExeca,
}));

vi.mock("../branch/index.js", () => ({
  ensureCleanWorkTree: mockEnsureClean,
  createSweepWorktree: mockCreateSweepWorktree,
  removeFixWorktree: mockRemoveFixWorktree,
  pruneStaleWorktrees: mockPruneStaleWorktrees,
}));

vi.mock("../fix-log/index.js", () => ({
  loadFixLog: mockLoadFixLog,
}));

vi.mock("./sweep-report.js", () => ({
  writeSweepReport: mockWriteSweepReport,
  writeSweepRegressions: mockWriteSweepRegressions,
}));

import { runSweep } from "./run-sweep.js";

function makeCluster(id: string, severity: "critical" | "high" | "medium" | "low" | "info" = "high") {
  return {
    id,
    file: `src/${id}.ts`,
    line: 10,
    category: "security" as const,
    severity,
    agents: ["claude"],
    agreement: 1,
    items: [],
    rationales: [{ agent: "claude", rationale: "test finding" }],
    suggestedChange: null,
  };
}

function makeScanResult(clusters: ReturnType<typeof makeCluster>[]) {
  return {
    results: [{ agent: "claude", status: "success", suggestions: [], rawOutput: "", rawError: "", durationMs: 100, startedAt: new Date().toISOString() }],
    clusters,
    totalSuggestions: clusters.length,
    totalDurationMs: 100,
  };
}

function makeFixResult(keptBranches: string[] = []) {
  return {
    items: [],
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
  // Default: scans return no findings, fixes return no kept branches
  mockRunScan.mockResolvedValue(makeScanResult([]));
  mockRunBatchedFix.mockResolvedValue(makeFixResult());
});

describe("sweep-types", () => {
  it("SWEEP_LAYERS has 7 layers covering all 11 tasks", () => {
    expect(SWEEP_LAYERS).toHaveLength(7);
    const allTasks = SWEEP_LAYERS.flatMap((l) => l.tasks);
    expect(allTasks).toHaveLength(11);
  });

  it("DEFAULT_MAX_ROUNDS is 3", () => {
    expect(DEFAULT_MAX_ROUNDS).toBe(3);
  });

  it("countCriticalHigh counts only critical and high", () => {
    const clusters = [
      makeCluster("a", "critical"),
      makeCluster("b", "high"),
      makeCluster("c", "medium"),
      makeCluster("d", "low"),
    ];
    expect(countCriticalHigh(clusters)).toBe(2);
  });
});

describe("runSweep", () => {
  it("completes immediately when no findings", async () => {
    const report = await runSweep({ repoPath: "/repo", auto: true });

    expect(report.exitReason).toBe("zero-critical-high");
    expect(report.totalRounds).toBe(1);
    expect(report.remaining).toEqual([]);
  });

  it("creates a sweep worktree", async () => {
    await runSweep({ repoPath: "/repo", auto: true });

    expect(mockEnsureClean).toHaveBeenCalled();
    expect(mockPruneStaleWorktrees).toHaveBeenCalled();
    expect(mockCreateSweepWorktree).toHaveBeenCalledWith(
      expect.stringContaining("/repo"),
    );
  });

  it("removes sweep worktree on completion", async () => {
    await runSweep({ repoPath: "/repo", auto: true });

    expect(mockRemoveFixWorktree).toHaveBeenCalledWith(
      expect.stringContaining("/repo"),
      "/tmp/kaicho-sweep-1234/kaicho-sweep-abc12345",
      "kaicho/sweep-abc12345",
      false,
    );
  });

  it("passes sweep worktree path to runBatchedFix and fixLogPath to original repo", async () => {
    let callCount = 0;
    mockRunScan.mockImplementation(async (opts: { task: string }) => {
      callCount++;
      if (opts.task === "security" && callCount === 1) {
        return makeScanResult([makeCluster("vuln1")]);
      }
      return makeScanResult([]);
    });
    mockRunBatchedFix.mockResolvedValue(makeFixResult(["kaicho/fix-vuln1"]));

    await runSweep({ repoPath: "/repo", auto: true, maxRounds: 1 });

    expect(mockRunBatchedFix).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: "/tmp/kaicho-sweep-1234/kaicho-sweep-abc12345",
        fixLogPath: expect.stringContaining("/repo"),
      }),
    );
  });

  it("writes reports to original repo, not worktree", async () => {
    await runSweep({ repoPath: "/repo", auto: true });

    expect(mockWriteSweepReport).toHaveBeenCalledWith(
      expect.stringContaining("/repo"),
      expect.anything(),
    );
    expect(mockWriteSweepReport).not.toHaveBeenCalledWith(
      expect.stringContaining("/tmp/kaicho-wt"),
      expect.anything(),
    );
  });

  it("scans all 7 layers in order", async () => {
    await runSweep({ repoPath: "/repo", auto: true, maxRounds: 1 });

    // Each layer scans its tasks + exit condition re-scans security + qa
    // 7 layers with varying task counts + 2 exit scans + regression re-scans + post-fix re-scans
    expect(mockRunScan).toHaveBeenCalled();
    const tasks = mockRunScan.mock.calls.map((c: unknown[]) => (c[0] as { task: string }).task);
    // First 11 calls should be the layer scans in order
    expect(tasks.slice(0, 11)).toEqual([
      "security", "qa", "contracts", "state", "resources", "resilience",
      "performance", "logging", "testing", "docs", "dx",
    ]);
  });

  it("fixes findings and merges branches", async () => {
    // Layer 1 (security) finds something
    let callCount = 0;
    mockRunScan.mockImplementation(async (opts: { task: string }) => {
      callCount++;
      if (opts.task === "security" && callCount === 1) {
        return makeScanResult([makeCluster("vuln1")]);
      }
      return makeScanResult([]);
    });

    mockRunBatchedFix.mockResolvedValue(makeFixResult(["kaicho/fix-vuln1"]));

    const report = await runSweep({ repoPath: "/repo", auto: true, maxRounds: 1 });

    expect(mockRunBatchedFix).toHaveBeenCalled();
    // Merging now happens inside runBatchedFix, so keptBranches reflects what was merged
    expect(report.rounds[0]!.layers[0]!.keptBranches).toContain("kaicho/fix-vuln1");
    expect(report.rounds[0]!.layers[0]!.fixed).toBe(1);
  });

  it("detects regressions and reverts", async () => {
    let securityScanCount = 0;
    mockRunScan.mockImplementation(async (opts: { task: string }) => {
      if (opts.task === "security") {
        securityScanCount++;
        // First security scan (layer 1): 0 findings → early return (no post-fix re-scan)
        // Second security scan (regression check after qa fix): new critical finding
        if (securityScanCount >= 2) {
          return makeScanResult([makeCluster("regression1", "critical")]);
        }
        return makeScanResult([]);
      }
      if (opts.task === "qa") {
        return makeScanResult([makeCluster("qa1", "medium")]);
      }
      return makeScanResult([]);
    });

    mockRunBatchedFix.mockResolvedValue(makeFixResult(["kaicho/fix-qa1"]));

    const report = await runSweep({ repoPath: "/repo", auto: true, maxRounds: 1 });

    // QA layer should have detected regression and reverted
    const qaLayer = report.rounds[0]!.layers[1];
    expect(qaLayer!.regressions.length).toBeGreaterThan(0);
    expect(mockExeca).toHaveBeenCalledWith(
      "git",
      ["revert", "--no-edit", "HEAD~1..HEAD"],
      expect.objectContaining({ cwd: expect.any(String) }),
    );
  });

  it("stops after max rounds", async () => {
    // Always return findings so exit condition never met
    mockRunScan.mockResolvedValue(makeScanResult([makeCluster("persistent", "high")]));
    mockRunBatchedFix.mockResolvedValue(makeFixResult());

    const report = await runSweep({ repoPath: "/repo", auto: true, maxRounds: 2 });

    expect(report.totalRounds).toBe(2);
    expect(report.exitReason).toBe("max-rounds");
  });

  it("exits early when zero critical/high in security + qa", async () => {
    // Round 1: findings exist, round 2: security+qa clean
    let round = 0;
    mockRunScan.mockImplementation(async (opts: { task: string }) => {
      if (opts.task === "security" && round === 0) {
        return makeScanResult([makeCluster("sec1", "high")]);
      }
      // After first round, security is clean
      return makeScanResult([makeCluster("low-issue", "low")]);
    });

    mockRunBatchedFix.mockImplementation(async () => {
      round++;
      return makeFixResult(["kaicho/fix-sec1"]);
    });

    const report = await runSweep({ repoPath: "/repo", auto: true, maxRounds: 3 });

    expect(report.exitReason).toBe("zero-critical-high");
  });

  it("writes sweep report", async () => {
    await runSweep({ repoPath: "/repo", auto: true });

    expect(mockWriteSweepReport).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ exitReason: expect.any(String) }),
    );
  });

  it("writes regressions report only when regressions occur", async () => {
    // No regressions
    await runSweep({ repoPath: "/repo", auto: true });
    expect(mockWriteSweepRegressions).not.toHaveBeenCalled();
  });

  it("fires onLayerStart and onLayerComplete callbacks", async () => {
    const starts: number[] = [];
    const completes: number[] = [];

    await runSweep({
      repoPath: "/repo",
      auto: true,
      maxRounds: 1,
      onLayerStart: (_, layer) => starts.push(layer.layer),
      onLayerComplete: (_, result) => completes.push(result.layer),
    });

    expect(starts).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(completes).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("fires onRoundComplete callback", async () => {
    const rounds: number[] = [];

    await runSweep({
      repoPath: "/repo",
      auto: true,
      maxRounds: 1,
      onRoundComplete: (result) => rounds.push(result.round),
    });

    expect(rounds).toEqual([1]);
  });
});
