import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SuggestionCluster } from "../dedup/index.js";

// Set up all mocks before importing the module under test
const mockEnsureClean = vi.fn().mockResolvedValue(undefined);
const mockCreateBranch = vi.fn().mockResolvedValue({ branch: "kaicho/fix-test", previousBranch: "main" });
const mockCaptureDiff = vi.fn().mockResolvedValue({ diff: "diff content", filesChanged: 1 });
const mockCommitFix = vi.fn().mockResolvedValue(undefined);
const mockDiscardBranch = vi.fn().mockResolvedValue(undefined);
const mockKeepBranch = vi.fn().mockResolvedValue(undefined);
const mockRecordFix = vi.fn().mockResolvedValue(undefined);

const mockAdapterRun = vi.fn().mockResolvedValue({
  agent: "claude",
  status: "success",
  suggestions: [],
  rawOutput: "",
  rawError: "",
  durationMs: 1000,
  startedAt: new Date().toISOString(),
});
const mockIsAvailable = vi.fn().mockResolvedValue(true);

vi.mock("../agent-adapters/index.js", () => {
  const make = (name: string) => ({
    config: { name, command: name, timeoutMs: 300000 },
    isAvailable: mockIsAvailable,
    run: mockAdapterRun,
  });
  return {
    ClaudeAdapter: vi.fn().mockImplementation(() => make("claude")),
    CodexAdapter: vi.fn().mockImplementation(() => make("codex")),
    CursorAdapter: vi.fn().mockImplementation(() => make("cursor")),
    GeminiAdapter: vi.fn().mockImplementation(() => make("gemini")),
  };
});

vi.mock("../branch/index.js", () => ({
  ensureCleanWorkTree: mockEnsureClean,
  createFixBranch: mockCreateBranch,
  captureDiff: mockCaptureDiff,
  commitFix: mockCommitFix,
  discardFixBranch: mockDiscardBranch,
  keepFixBranch: mockKeepBranch,
}));

vi.mock("../fix-log/index.js", () => ({
  recordFix: mockRecordFix,
}));

// Import after mocks are set up
const { runFix } = await import("./run-fix.js");

function makeCluster(overrides: Partial<SuggestionCluster> = {}): SuggestionCluster {
  return {
    id: "abc123",
    file: "src/app.ts",
    line: 10,
    category: "security",
    severity: "high",
    agents: ["claude"],
    agreement: 1,
    rationales: [{ agent: "claude", rationale: "Test issue" }],
    suggestedChange: "Fix it",
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAvailable.mockResolvedValue(true);
  mockEnsureClean.mockResolvedValue(undefined);
  mockCaptureDiff.mockResolvedValue({ diff: "diff content", filesChanged: 1 });
  mockAdapterRun.mockResolvedValue({
    agent: "claude",
    status: "success",
    suggestions: [],
    rawOutput: "",
    rawError: "",
    durationMs: 1000,
    startedAt: new Date().toISOString(),
  });
});

describe("runFix", () => {
  it("returns applied status on success", async () => {
    const result = await runFix({
      repoPath: "/test/repo",
      cluster: makeCluster(),
    });

    expect(result.status).toBe("applied");
    expect(result.agent).toBe("claude");
    expect(result.branch).toBe("kaicho/fix-test");
    expect(result.filesChanged).toBe(1);
  });

  it("returns dirty-worktree when tree is dirty", async () => {
    mockEnsureClean.mockRejectedValueOnce(new Error("uncommitted changes"));

    const result = await runFix({
      repoPath: "/test/repo",
      cluster: makeCluster(),
    });

    expect(result.status).toBe("dirty-worktree");
    expect(result.error).toContain("uncommitted");
  });

  it("returns agent-error when agent not available", async () => {
    mockIsAvailable.mockResolvedValueOnce(false);

    const result = await runFix({
      repoPath: "/test/repo",
      cluster: makeCluster(),
    });

    expect(result.status).toBe("agent-error");
    expect(result.error).toContain("not found");
  });

  it("returns no-changes when agent makes no edits", async () => {
    mockCaptureDiff.mockResolvedValueOnce({ diff: "", filesChanged: 0 });

    const result = await runFix({
      repoPath: "/test/repo",
      cluster: makeCluster(),
    });

    expect(result.status).toBe("no-changes");
  });

  it("defaults to first agent that found the issue", async () => {
    const result = await runFix({
      repoPath: "/test/repo",
      cluster: makeCluster({ agents: ["codex", "claude"] }),
    });

    expect(result.agent).toBe("codex");
  });

  it("respects agent override", async () => {
    const result = await runFix({
      repoPath: "/test/repo",
      cluster: makeCluster({ agents: ["codex"] }),
      agent: "claude",
    });

    expect(result.agent).toBe("claude");
  });

  it("fires progress callbacks", async () => {
    const steps: string[] = [];

    await runFix({
      repoPath: "/test/repo",
      cluster: makeCluster(),
      onProgress: (p) => steps.push(p.step),
    });

    expect(steps).toContain("check-worktree");
    expect(steps).toContain("create-branch");
    expect(steps).toContain("running-agent");
    expect(steps).toContain("capture-diff");
    expect(steps).toContain("commit");
    expect(steps).toContain("done");
  });

  it("records fix in fix log on success", async () => {
    await runFix({
      repoPath: "/test/repo",
      cluster: makeCluster(),
    });

    expect(mockRecordFix).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ clusterId: "abc123", agent: "claude" }),
    );
  });

  it("discards branch on agent failure", async () => {
    mockAdapterRun.mockResolvedValueOnce({
      agent: "claude",
      status: "agent-error",
      suggestions: [],
      rawOutput: "",
      rawError: "timeout",
      durationMs: 0,
      startedAt: new Date().toISOString(),
      error: "Agent timed out",
    });

    await runFix({
      repoPath: "/test/repo",
      cluster: makeCluster(),
    });

    expect(mockDiscardBranch).toHaveBeenCalled();
  });

  it("discards branch when no changes", async () => {
    mockCaptureDiff.mockResolvedValueOnce({ diff: "", filesChanged: 0 });

    await runFix({
      repoPath: "/test/repo",
      cluster: makeCluster(),
    });

    expect(mockDiscardBranch).toHaveBeenCalled();
  });
});
