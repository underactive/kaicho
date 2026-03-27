import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SuggestionCluster } from "../dedup/index.js";

const {
  mockEnsureClean, mockGetCurrentBranch, mockCaptureDiff, mockCommitFix,
  mockCreateWorktree, mockRemoveWorktree, mockPruneWorktrees, mockCleanupBase,
  mockRecordFix, mockAdapterRun, mockIsAvailable,
} = vi.hoisted(() => ({
  mockEnsureClean: vi.fn().mockResolvedValue(undefined),
  mockGetCurrentBranch: vi.fn().mockResolvedValue("main"),
  mockCaptureDiff: vi.fn().mockResolvedValue({ diff: "diff content", filesChanged: 1 }),
  mockCommitFix: vi.fn().mockResolvedValue(undefined),
  mockCreateWorktree: vi.fn().mockImplementation(async () => ({
    worktreePath: `/tmp/kaicho-wt/${Math.random().toString(36).slice(2)}`,
    branch: `kaicho/fix-${Math.random().toString(36).slice(2, 10)}`,
  })),
  mockRemoveWorktree: vi.fn().mockResolvedValue(undefined),
  mockPruneWorktrees: vi.fn().mockResolvedValue(undefined),
  mockCleanupBase: vi.fn().mockResolvedValue(undefined),
  mockRecordFix: vi.fn().mockResolvedValue(undefined),
  mockAdapterRun: vi.fn().mockResolvedValue({
    agent: "claude", status: "success", suggestions: [],
    rawOutput: "", rawError: "", durationMs: 1000, startedAt: new Date().toISOString(),
  }),
  mockIsAvailable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../agent-adapters/index.js", () => {
  const make = (name: string) => ({
    config: { name, command: name, timeoutMs: 300000 },
    isAvailable: mockIsAvailable,
    run: mockAdapterRun,
  });
  return {
    ClaudeAdapter: vi.fn(() => make("claude")),
    CodexAdapter: vi.fn(() => make("codex")),
    CursorAdapter: vi.fn(() => make("cursor")),
    GeminiAdapter: vi.fn(() => make("gemini")),
  };
});

vi.mock("../branch/index.js", () => ({
  ensureCleanWorkTree: mockEnsureClean,
  getCurrentBranch: mockGetCurrentBranch,
  captureDiff: mockCaptureDiff,
  commitFix: mockCommitFix,
  createFixWorktree: mockCreateWorktree,
  removeFixWorktree: mockRemoveWorktree,
  pruneStaleWorktrees: mockPruneWorktrees,
  cleanupWorktreeBase: mockCleanupBase,
  resetLastCommit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../fix-log/index.js", () => ({
  recordFix: mockRecordFix,
}));

vi.mock("../config/index.js", () => ({
  AGENT_CONFIGS: { claude: {}, codex: {}, cursor: {}, gemini: {} },
  DEFAULT_TIMEOUT_MS: 1800000,
}));

import { runParallelFix } from "./run-parallel-fix.js";

function makeCluster(id: string, file: string): SuggestionCluster {
  return {
    id, file, line: 10, category: "security", severity: "high",
    agents: ["claude"], agreement: 1, items: [],
    rationales: [{ agent: "claude", rationale: "test" }],
    suggestedChange: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapterRun.mockResolvedValue({
    agent: "claude", status: "success", suggestions: [],
    rawOutput: "", rawError: "", durationMs: 1000, startedAt: new Date().toISOString(),
  });
  mockCaptureDiff.mockResolvedValue({ diff: "diff content", filesChanged: 1 });
  mockIsAvailable.mockResolvedValue(true);
  mockCreateWorktree.mockImplementation(async () => ({
    worktreePath: `/tmp/kaicho-wt/${Math.random().toString(36).slice(2)}`,
    branch: `kaicho/fix-${Math.random().toString(36).slice(2, 10)}`,
  }));
});

describe("runParallelFix", () => {
  it("creates a worktree per cluster and runs agents", async () => {
    const clusters = [makeCluster("a1", "src/a.ts"), makeCluster("b2", "src/b.ts")];

    const result = await runParallelFix({
      repoPath: "/repo",
      clusters,
      auto: true,
    });

    expect(mockCreateWorktree).toHaveBeenCalledTimes(2);
    expect(mockAdapterRun).toHaveBeenCalledTimes(2);
    expect(result.totalApplied).toBe(2);
    expect(result.totalKept).toBe(2);
    expect(result.keptBranches).toHaveLength(2);
  });

  it("respects concurrency limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    mockAdapterRun.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return {
        agent: "claude", status: "success", suggestions: [],
        rawOutput: "", rawError: "", durationMs: 100, startedAt: new Date().toISOString(),
      };
    });

    const clusters = Array.from({ length: 6 }, (_, i) => makeCluster(`c${i}`, `src/${i}.ts`));

    await runParallelFix({
      repoPath: "/repo",
      clusters,
      concurrency: 2,
      auto: true,
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("cleans up worktree on agent failure", async () => {
    mockAdapterRun.mockResolvedValueOnce({
      agent: "claude", status: "agent-error", suggestions: [],
      rawOutput: "", rawError: "boom", durationMs: 100, startedAt: new Date().toISOString(),
      error: "Agent crashed",
    });

    const result = await runParallelFix({
      repoPath: "/repo",
      clusters: [makeCluster("a1", "src/a.ts")],
      auto: true,
    });

    expect(result.totalFailed).toBe(1);
    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(String), true,
    );
  });

  it("cleans up worktree on no-changes", async () => {
    mockCaptureDiff.mockResolvedValueOnce({ diff: "", filesChanged: 0 });

    const result = await runParallelFix({
      repoPath: "/repo",
      clusters: [makeCluster("a1", "src/a.ts")],
      auto: true,
    });

    expect(result.totalSkipped).toBe(1);
    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(String), true,
    );
  });

  it("calls onConfirm for each applied fix when not auto", async () => {
    const onConfirm = vi.fn().mockResolvedValue("keep" as const);

    const result = await runParallelFix({
      repoPath: "/repo",
      clusters: [makeCluster("a1", "src/a.ts"), makeCluster("b2", "src/b.ts")],
      onConfirm,
    });

    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(result.totalKept).toBe(2);
    expect(mockRecordFix).toHaveBeenCalledTimes(2);
  });

  it("discards branch when user selects discard", async () => {
    const onConfirm = vi.fn().mockResolvedValue("discard" as const);

    const result = await runParallelFix({
      repoPath: "/repo",
      clusters: [makeCluster("a1", "src/a.ts")],
      onConfirm,
    });

    expect(result.totalDiscarded).toBe(1);
    expect(result.keptBranches).toHaveLength(0);
    expect(mockRecordFix).not.toHaveBeenCalled();
  });

  it("prunes stale worktrees at start", async () => {
    await runParallelFix({
      repoPath: "/repo",
      clusters: [],
      auto: true,
    });

    expect(mockPruneWorktrees).toHaveBeenCalledTimes(1);
  });
});
