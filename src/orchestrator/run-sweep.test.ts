import { describe, it, expect, vi, beforeEach } from "vitest";
import { SWEEP_LAYERS, DEFAULT_MAX_ROUNDS, countCriticalHigh } from "./sweep-types.js";

const {
  mockRunScan, mockRunBatchedFix,
  mockEnsureClean, mockCreateSweepWorktree, mockRemoveFixWorktree, mockPruneStaleWorktrees,
  mockPruneOrphanFixBranches, mockExeca,
  mockLoadFixLog, mockWriteSweepReport, mockWriteSweepRegressions,
} = vi.hoisted(() => ({
  mockRunScan: vi.fn(),
  mockRunBatchedFix: vi.fn(),
  mockEnsureClean: vi.fn().mockResolvedValue(undefined),
  mockCreateSweepWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/kaicho-sweep-1234/kaicho-sweep-abc12345", branch: "kaicho/sweep-abc12345" }),
  mockRemoveFixWorktree: vi.fn().mockResolvedValue(undefined),
  mockPruneStaleWorktrees: vi.fn().mockResolvedValue(undefined),
  mockPruneOrphanFixBranches: vi.fn().mockResolvedValue(undefined),
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
  pruneOrphanFixBranches: mockPruneOrphanFixBranches,
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

  it("tags sweep branch after each layer that merges fixes", async () => {
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

    // Should tag after layer 1 (which had fixes)
    expect(mockExeca).toHaveBeenCalledWith(
      "git",
      ["tag", "kaicho/sweep-abc12345/r1-layer-1", "HEAD"],
      expect.objectContaining({ cwd: "/tmp/kaicho-sweep-1234/kaicho-sweep-abc12345" }),
    );

    // Should NOT tag layers with no fixes (e.g., layer 2)
    expect(mockExeca).not.toHaveBeenCalledWith(
      "git",
      ["tag", "kaicho/sweep-abc12345/r1-layer-2", "HEAD"],
      expect.anything(),
    );
  });

  it("detects regressions and flags them without reverting", async () => {
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

    // QA layer should have detected regression and flagged it
    const qaLayer = report.rounds[0]!.layers[1];
    expect(qaLayer!.regressions.length).toBeGreaterThan(0);
    expect(qaLayer!.regressions[0]!.flaggedBranches).toEqual(["kaicho/fix-qa1"]);

    // Fixes are preserved (not reverted)
    expect(qaLayer!.fixed).toBe(1);
    expect(qaLayer!.keptBranches).toEqual(["kaicho/fix-qa1"]);

    // git revert was NOT called
    expect(mockExeca).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["revert"]),
      expect.anything(),
    );
  });

  it("checks regressions against all previous layers, not just the immediate one", async () => {
    let securityScanCount = 0;
    mockRunScan.mockImplementation(async (opts: { task: string }) => {
      if (opts.task === "security") {
        securityScanCount++;
        // Layer 1 scan: 0 findings
        // Layer 3 regression check against layer 1: new critical finding
        if (securityScanCount >= 2) {
          return makeScanResult([makeCluster("sec-regression", "critical")]);
        }
        return makeScanResult([]);
      }
      if (opts.task === "qa") {
        return makeScanResult([]);
      }
      if (opts.task === "contracts") {
        return makeScanResult([makeCluster("contract1", "medium")]);
      }
      return makeScanResult([]);
    });

    mockRunBatchedFix.mockResolvedValue(makeFixResult(["kaicho/fix-contract1"]));

    const report = await runSweep({ repoPath: "/repo", auto: true, maxRounds: 1 });

    // Layer 3 (contracts, state) should detect regression in layer 1 (security)
    const layer3 = report.rounds[0]!.layers[2];
    expect(layer3!.regressions.length).toBeGreaterThan(0);
    expect(layer3!.regressions[0]!.previousLayerTasks).toContain("security");
    // Fixes still kept
    expect(layer3!.fixed).toBe(1);
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

describe("two-pass strategy", () => {
  it("runs layers in reverse order in Pass 1", async () => {
    await runSweep({ repoPath: "/repo", auto: true, twoPass: true, maxRounds: 1 });

    const tasks = mockRunScan.mock.calls.map((c: unknown[]) => (c[0] as { task: string }).task);
    // Pass 1 only (maxRounds: 1 skips Pass 2) — layers 7→1 reversed
    expect(tasks.slice(0, 11)).toEqual([
      "testing", "docs", "dx", "logging", "performance",
      "resources", "resilience", "contracts", "state", "qa", "security",
    ]);
  });

  it("skips regression checks in Pass 1", async () => {
    // Layer 7 (testing/docs/dx) finds something and fixes it
    mockRunScan.mockImplementation(async (opts: { task: string }) => {
      if (opts.task === "testing") return makeScanResult([makeCluster("test1", "medium")]);
      return makeScanResult([]);
    });
    mockRunBatchedFix.mockResolvedValue(makeFixResult(["kaicho/fix-test1"]));

    const report = await runSweep({ repoPath: "/repo", auto: true, twoPass: true, maxRounds: 1 });

    // Pass 1 should have zero regressions (no regression checks ran)
    expect(report.rounds[0]!.totalRegressions).toBe(0);
  });

  it("disables validation in Pass 1", async () => {
    mockRunScan.mockImplementation(async (opts: { task: string }) => {
      if (opts.task === "testing") return makeScanResult([makeCluster("test1")]);
      return makeScanResult([]);
    });
    mockRunBatchedFix.mockResolvedValue(makeFixResult(["kaicho/fix-test1"]));

    await runSweep({ repoPath: "/repo", auto: true, twoPass: true, validate: true, maxRounds: 1 });

    // runBatchedFix should be called with validate: false in Pass 1
    const fixCall = mockRunBatchedFix.mock.calls[0]?.[0];
    expect(fixCall.validate).toBe(false);
  });

  it("runs only security + qa in Pass 2", async () => {
    await runSweep({ repoPath: "/repo", auto: true, twoPass: true });

    const tasks = mockRunScan.mock.calls.map((c: unknown[]) => (c[0] as { task: string }).task);
    // After 11 Pass 1 tasks, Pass 2 should scan security + qa + exit condition scans
    const pass2Tasks = tasks.slice(11);
    const uniquePass2Tasks = [...new Set(pass2Tasks)];
    expect(uniquePass2Tasks.every((t: string) => t === "security" || t === "qa")).toBe(true);
  });

  it("enables regression checks in Pass 2", async () => {
    let securityScanCount = 0;
    mockRunScan.mockImplementation(async (opts: { task: string }) => {
      if (opts.task === "security") {
        securityScanCount++;
        // Pass 1 scans security once (layer scan). Pass 2 scans it twice
        // (layer scan + regression check after qa). Return critical on the
        // regression check (3rd security scan overall).
        if (securityScanCount >= 3) {
          return makeScanResult([makeCluster("sec-reg", "critical")]);
        }
        return makeScanResult([]);
      }
      if (opts.task === "qa") return makeScanResult([makeCluster("qa1", "medium")]);
      return makeScanResult([]);
    });
    mockRunBatchedFix.mockResolvedValue(makeFixResult(["kaicho/fix-qa1"]));

    const report = await runSweep({ repoPath: "/repo", auto: true, twoPass: true });

    // Pass 2 (round 2) should have regression in qa layer
    const pass2 = report.rounds.find((r) => r.pass === 2);
    expect(pass2).toBeDefined();
    const qaLayer = pass2!.layers.find((l) => l.tasks.includes("qa"));
    expect(qaLayer!.regressions.length).toBeGreaterThan(0);
  });

  it("preserves validation setting in Pass 2", async () => {
    mockRunScan.mockImplementation(async (opts: { task: string }) => {
      if (opts.task === "security") return makeScanResult([makeCluster("sec1")]);
      return makeScanResult([]);
    });
    mockRunBatchedFix.mockResolvedValue(makeFixResult(["kaicho/fix-sec1"]));

    await runSweep({ repoPath: "/repo", auto: true, twoPass: true, validate: true });

    // Pass 2 fix calls should have validate: true
    const fixCalls = mockRunBatchedFix.mock.calls;
    const pass2FixCall = fixCalls[fixCalls.length - 1]?.[0];
    expect(pass2FixCall.validate).toBe(true);
  });

  it("sets strategy to two-pass in report", async () => {
    const report = await runSweep({ repoPath: "/repo", auto: true, twoPass: true });

    expect(report.strategy).toBe("two-pass");
  });

  it("sets strategy to single-pass by default", async () => {
    const report = await runSweep({ repoPath: "/repo", auto: true });

    expect(report.strategy).toBe("single-pass");
  });

  it("skips Pass 2 when maxRounds is 1", async () => {
    const report = await runSweep({ repoPath: "/repo", auto: true, twoPass: true, maxRounds: 1 });

    expect(report.totalRounds).toBe(1);
    expect(report.rounds[0]!.pass).toBe(1);
    expect(report.rounds.find((r) => r.pass === 2)).toBeUndefined();
  });

  it("tags use pass1/pass2 prefix", async () => {
    mockRunScan.mockImplementation(async (opts: { task: string }) => {
      if (opts.task === "testing" || opts.task === "security") {
        return makeScanResult([makeCluster(`${opts.task}-1`)]);
      }
      return makeScanResult([]);
    });
    mockRunBatchedFix.mockResolvedValue(makeFixResult(["kaicho/fix-1"]));

    await runSweep({ repoPath: "/repo", auto: true, twoPass: true });

    // Pass 1 tag (layer 7 = testing/docs/dx, first in reversed order)
    expect(mockExeca).toHaveBeenCalledWith(
      "git", ["tag", "kaicho/sweep-abc12345/pass1-layer-7", "HEAD"],
      expect.objectContaining({ cwd: "/tmp/kaicho-sweep-1234/kaicho-sweep-abc12345" }),
    );

    // Pass 2 tag (layer 1 = security)
    expect(mockExeca).toHaveBeenCalledWith(
      "git", ["tag", "kaicho/sweep-abc12345/pass2-layer-1", "HEAD"],
      expect.objectContaining({ cwd: "/tmp/kaicho-sweep-1234/kaicho-sweep-abc12345" }),
    );
  });

  it("exits with zero-critical-high after Pass 2", async () => {
    // All scans return nothing — Pass 2 exit scan finds zero critical/high
    const report = await runSweep({ repoPath: "/repo", auto: true, twoPass: true });

    expect(report.exitReason).toBe("zero-critical-high");
  });
});
