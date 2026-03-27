import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Suggestion, RunResult } from "../../types/index.js";
import type { SuggestionCluster } from "../../dedup/index.js";

// Capture stdout writes
let output: string;
const originalWrite = process.stdout.write;

beforeEach(() => {
  output = "";
  process.stdout.write = ((chunk: string) => {
    output += chunk;
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

// Import after setup so NO_COLOR is evaluated at import time
const { formatHuman, formatMultiHuman } = await import("./human.js");

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    agent: "claude",
    status: "success",
    suggestions: [
      { file: "app.ts", line: 10, category: "security", severity: "high", rationale: "Test issue found here", suggestedChange: "Fix it" },
    ],
    rawOutput: "",
    rawError: "",
    durationMs: 5000,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCluster(overrides: Partial<SuggestionCluster> = {}): SuggestionCluster {
  return {
    id: "abc123",
    file: "app.ts",
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

describe("formatHuman", () => {
  it("shows error for non-success status", () => {
    formatHuman(makeResult({ status: "timeout", error: "Agent timed out" }));
    expect(output).toContain("Agent timed out");
  });

  it("shows no-suggestions message", () => {
    formatHuman(makeResult({ suggestions: [] }));
    expect(output).toContain("No suggestions");
  });

  it("groups suggestions by file", () => {
    formatHuman(makeResult({
      suggestions: [
        { file: "a.ts", line: 1, category: "security", severity: "high", rationale: "Issue A", suggestedChange: null },
        { file: "b.ts", line: 1, category: "security", severity: "low", rationale: "Issue B", suggestedChange: null },
        { file: "a.ts", line: 5, category: "bug", severity: "medium", rationale: "Issue C", suggestedChange: null },
      ],
    }));
    // a.ts should appear before its second suggestion
    const aIdx = output.indexOf("a.ts");
    const bIdx = output.indexOf("b.ts");
    expect(aIdx).toBeLessThan(bIdx);
  });

  it("shows suggestion count and duration", () => {
    formatHuman(makeResult());
    expect(output).toContain("1 suggestion");
    expect(output).toContain("5.0s");
  });

  it("shows suggested change with marker", () => {
    formatHuman(makeResult());
    expect(output).toContain("▸");
    expect(output).toContain("Fix it");
  });
});

describe("formatMultiHuman", () => {
  it("shows agent status summary", () => {
    formatMultiHuman({
      results: [makeResult(), makeResult({ agent: "codex", durationMs: 3000 })],
      clusters: [makeCluster({ agents: ["claude", "codex"], agreement: 2 })],
      totalSuggestions: 2,
      totalDurationMs: 5000,
    });
    expect(output).toContain("[claude]");
    expect(output).toContain("[codex]");
  });

  it("shows skipped agents", () => {
    formatMultiHuman({
      results: [makeResult({ agent: "gemini", status: "skipped", suggestions: [], durationMs: 0 })],
      clusters: [],
      totalSuggestions: 0,
      totalDurationMs: 0,
    });
    expect(output).toContain("skipped");
  });

  it("shows cluster IDs", () => {
    formatMultiHuman({
      results: [makeResult()],
      clusters: [makeCluster()],
      totalSuggestions: 1,
      totalDurationMs: 5000,
    });
    expect(output).toContain("abc123");
  });

  it("shows agreement badge for multi-agent clusters", () => {
    formatMultiHuman({
      results: [makeResult()],
      clusters: [makeCluster({ agents: ["claude", "codex"], agreement: 2 })],
      totalSuggestions: 1,
      totalDurationMs: 5000,
    });
    expect(output).toContain("2x");
  });

  it("shows [fixed] marker", () => {
    formatMultiHuman({
      results: [makeResult()],
      clusters: [makeCluster({ fixed: true })],
      totalSuggestions: 1,
      totalDurationMs: 5000,
    });
    expect(output).toContain("[fixed]");
  });

  it("shows summary when enriched", () => {
    formatMultiHuman({
      results: [makeResult()],
      clusters: [makeCluster({ summary: "SQL injection in query builder" })],
      totalSuggestions: 1,
      totalDurationMs: 5000,
    });
    expect(output).toContain("SQL injection in query builder");
  });

  it("shows finding count summary", () => {
    formatMultiHuman({
      results: [makeResult()],
      clusters: [makeCluster(), makeCluster({ id: "def456", file: "b.ts" })],
      totalSuggestions: 2,
      totalDurationMs: 5000,
    });
    expect(output).toContain("2 findings");
  });
});
