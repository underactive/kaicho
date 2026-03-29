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

vi.mock("../repo-context/index.js", () => ({
  fingerprint: vi.fn().mockResolvedValue({
    languages: [],
    frameworks: [],
    testRunners: [],
    linters: [],
    entryPoints: [],
    packageManager: null,
    monorepoTool: null,
    architectureDocs: [],
    workspacePackages: [],
  }),
  formatRepoContext: vi.fn().mockReturnValue(""),
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

  it("runs specific agents when --agents specified", async () => {
    const result = await runScan({
      agents: ["codex"],
      task: "security",
      repoPath: "/test/repo",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.agent).toBe("codex");
  });

  it("excludes agents with --exclude", async () => {
    const result = await runScan({
      exclude: ["claude", "gemini"],
      task: "security",
      repoPath: "/test/repo",
    });

    expect(result.results).toHaveLength(2);
    const agents = result.results.map((r) => r.agent);
    expect(agents).toContain("codex");
    expect(agents).toContain("cursor");
    expect(agents).not.toContain("claude");
  });

  it("returns error for unknown task listing all available", async () => {
    const { SCAN_TASKS } = await import("../prompts/index.js");
    const result = await runScan({
      task: "nonexistent",
      repoPath: "/test/repo",
    });

    expect(result.results[0]?.status).toBe("agent-error");
    expect(result.results[0]?.error).toContain("Unknown task");
    for (const task of SCAN_TASKS) {
      expect(result.results[0]?.error).toContain(task);
    }
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

describe("repo-context integration", () => {
  it("includes PROJECT CONTEXT in prompt when fingerprint succeeds", async () => {
    const { fingerprint, formatRepoContext } = await import("../repo-context/index.js");
    vi.mocked(fingerprint).mockResolvedValue({
      languages: [{ name: "TypeScript", source: "tsconfig.json" }],
      frameworks: [{ name: "Next.js", source: "package.json" }],
      testRunners: [],
      linters: [],
      entryPoints: [],
      packageManager: null,
      monorepoTool: null,
      architectureDocs: [],
      workspacePackages: [],
    });
    vi.mocked(formatRepoContext).mockReturnValue(
      "PROJECT CONTEXT (best-effort repo-level hints — may be incomplete or outdated):\n- Languages: TypeScript\n- Frameworks: Next.js",
    );

    const { ClaudeAdapter } = await import("../agent-adapters/index.js");
    const mockRun = vi.fn().mockResolvedValue({
      agent: "claude",
      status: "success",
      suggestions: [],
      rawOutput: "",
      rawError: "",
      durationMs: 100,
      startedAt: new Date().toISOString(),
    });
    vi.mocked(ClaudeAdapter).mockImplementation(() => ({
      config: { name: "claude", command: "claude", timeoutMs: 300000 },
      isAvailable: vi.fn().mockResolvedValue(true),
      run: mockRun,
    }) as never);

    await runScan({
      agents: ["claude"],
      task: "security",
      repoPath: "/test/repo",
    });

    const prompt = mockRun.mock.calls[0]?.[1] as string;
    expect(prompt).toContain("PROJECT CONTEXT");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("Next.js");
  });

  it("omits context when fingerprint returns empty context", async () => {
    const { fingerprint, formatRepoContext } = await import("../repo-context/index.js");
    vi.mocked(fingerprint).mockResolvedValue({
      languages: [],
      frameworks: [],
      testRunners: [],
      linters: [],
      entryPoints: [],
      packageManager: null,
      monorepoTool: null,
      architectureDocs: [],
      workspacePackages: [],
    });
    vi.mocked(formatRepoContext).mockReturnValue("");

    const { ClaudeAdapter } = await import("../agent-adapters/index.js");
    const mockRun = vi.fn().mockResolvedValue({
      agent: "claude",
      status: "success",
      suggestions: [],
      rawOutput: "",
      rawError: "",
      durationMs: 100,
      startedAt: new Date().toISOString(),
    });
    vi.mocked(ClaudeAdapter).mockImplementation(() => ({
      config: { name: "claude", command: "claude", timeoutMs: 300000 },
      isAvailable: vi.fn().mockResolvedValue(true),
      run: mockRun,
    }) as never);

    await runScan({
      agents: ["claude"],
      task: "security",
      repoPath: "/test/repo",
    });

    const prompt = mockRun.mock.calls[0]?.[1] as string;
    expect(prompt).not.toContain("PROJECT CONTEXT");
  });

  it("continues scan when fingerprint throws", async () => {
    const { fingerprint } = await import("../repo-context/index.js");
    vi.mocked(fingerprint).mockRejectedValue(new Error("disk on fire"));

    const result = await runScan({
      task: "security",
      repoPath: "/test/repo",
    });

    // Scan should succeed despite fingerprint failure
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r) => r.status === "success" || r.status === "skipped")).toBe(true);
  });
});
