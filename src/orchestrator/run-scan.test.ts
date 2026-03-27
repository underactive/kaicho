import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScan } from "./run-scan.js";

// Mock all dependencies
vi.mock("../agent-adapters/index.js", () => {
  const makeAdapter = (name: string) => ({
    config: { name, command: name, timeoutMs: 300000 },
    isAvailable: vi.fn().mockResolvedValue(true),
    run: vi.fn().mockResolvedValue({
      agent: name,
      status: "success",
      suggestions: [
        { file: "test.ts", line: 1, category: "security", severity: "high", rationale: `${name} found issue`, suggestedChange: null },
      ],
      rawOutput: "",
      rawError: "",
      durationMs: 1000,
      startedAt: new Date().toISOString(),
    }),
  });
  return {
    ClaudeAdapter: vi.fn().mockImplementation(() => makeAdapter("claude")),
    CodexAdapter: vi.fn().mockImplementation(() => makeAdapter("codex")),
    CursorAdapter: vi.fn().mockImplementation(() => makeAdapter("cursor")),
    GeminiAdapter: vi.fn().mockImplementation(() => makeAdapter("gemini")),
  };
});

vi.mock("../suggestion-store/index.js", () => ({
  JsonStore: vi.fn().mockImplementation(() => ({
    save: vi.fn().mockResolvedValue("/fake/path.json"),
  })),
}));

vi.mock("../scope/index.js", () => ({
  resolveScope: vi.fn().mockResolvedValue(null),
  buildFileManifest: vi.fn().mockReturnValue("files"),
}));

vi.mock("../summarizer/index.js", () => ({
  summarizeClusters: vi.fn().mockResolvedValue(0),
  saveEnrichedCache: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runScan", () => {
  it("runs all agents when no agent specified", async () => {
    const result = await runScan({
      task: "security",
      repoPath: "/test/repo",
    });

    expect(result.results).toHaveLength(4);
    expect(result.results.map((r) => r.agent)).toEqual(["claude", "codex", "cursor", "gemini"]);
  });

  it("runs single agent when specified", async () => {
    const result = await runScan({
      agent: "codex",
      task: "security",
      repoPath: "/test/repo",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.agent).toBe("codex");
  });

  it("returns error for unknown task", async () => {
    const result = await runScan({
      task: "nonexistent",
      repoPath: "/test/repo",
    });

    expect(result.results[0]?.status).toBe("agent-error");
    expect(result.results[0]?.error).toContain("Unknown task");
  });

  it("clusters suggestions from multiple agents", async () => {
    const result = await runScan({
      task: "security",
      repoPath: "/test/repo",
    });

    // All 4 agents return a suggestion on test.ts:1, should cluster to 1
    expect(result.clusters.length).toBeGreaterThanOrEqual(1);
    expect(result.totalSuggestions).toBe(4);
  });

  it("fires progress callbacks", async () => {
    const events: Array<{ agent: string; status: string }> = [];

    await runScan({
      task: "security",
      repoPath: "/test/repo",
      onProgress: (p) => events.push({ agent: p.agent, status: p.status }),
    });

    const started = events.filter((e) => e.status === "started");
    const done = events.filter((e) => e.status === "done");
    expect(started).toHaveLength(4);
    expect(done).toHaveLength(4);
  });

  it("skips unavailable agents", async () => {
    const { ClaudeAdapter } = await import("../agent-adapters/index.js");
    vi.mocked(ClaudeAdapter).mockImplementation(() => ({
      config: { name: "claude", command: "claude", timeoutMs: 300000 },
      isAvailable: vi.fn().mockResolvedValue(false),
      run: vi.fn(),
    }) as never);

    const result = await runScan({
      task: "security",
      repoPath: "/test/repo",
    });

    const claude = result.results.find((r) => r.agent === "claude");
    expect(claude?.status).toBe("skipped");
  });
});
