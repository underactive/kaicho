import { describe, it, expect } from "vitest";
import { clusterSuggestions } from "./cluster.js";
import type { RunResult, Suggestion } from "../types/index.js";

function makeSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    file: "src/app.ts",
    line: 10,
    category: "security",
    severity: "high",
    rationale: "Test issue",
    suggestedChange: null,
    ...overrides,
  };
}

function makeResult(agent: string, suggestions: Suggestion[]): RunResult {
  return {
    agent,
    status: "success",
    suggestions,
    rawOutput: "",
    rawError: "",
    durationMs: 1000,
    startedAt: new Date().toISOString(),
  };
}

describe("clusterSuggestions", () => {
  it("clusters suggestions from different agents on nearby lines", () => {
    const results = [
      makeResult("claude", [
        makeSuggestion({ file: "dfu/zip.js", line: 18, rationale: "Decompression bomb risk" }),
      ]),
      makeResult("codex", [
        makeSuggestion({ file: "dfu/zip.js", line: 18, rationale: "Untrusted DFU packages decompressed in memory", severity: "low" }),
      ]),
      makeResult("cursor", [
        makeSuggestion({ file: "dfu/zip.js", line: 17, rationale: "unzipSync decompresses entire archive in memory", severity: "medium" }),
      ]),
    ];

    const clusters = clusterSuggestions(results);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.agreement).toBe(3);
    expect(clusters[0]!.agents).toContain("claude");
    expect(clusters[0]!.agents).toContain("codex");
    expect(clusters[0]!.agents).toContain("cursor");
    expect(clusters[0]!.rationales).toHaveLength(3);
    // Highest severity should be picked
    expect(clusters[0]!.severity).toBe("high");
  });

  it("keeps distant lines in separate clusters", () => {
    const results = [
      makeResult("claude", [
        makeSuggestion({ file: "app.ts", line: 10 }),
        makeSuggestion({ file: "app.ts", line: 100 }),
      ]),
    ];

    const clusters = clusterSuggestions(results);
    expect(clusters).toHaveLength(2);
  });

  it("clusters within ±5 line proximity", () => {
    const results = [
      makeResult("agent-a", [makeSuggestion({ file: "f.ts", line: 10 })]),
      makeResult("agent-b", [makeSuggestion({ file: "f.ts", line: 15 })]),
    ];

    const clusters = clusterSuggestions(results);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.agreement).toBe(2);
  });

  it("does not cluster lines > 5 apart", () => {
    const results = [
      makeResult("agent-a", [makeSuggestion({ file: "f.ts", line: 10 })]),
      makeResult("agent-b", [makeSuggestion({ file: "f.ts", line: 16 })]),
    ];

    const clusters = clusterSuggestions(results);
    expect(clusters).toHaveLength(2);
  });

  it("clusters null-line suggestions by category", () => {
    const results = [
      makeResult("claude", [
        makeSuggestion({ file: "README.md", line: null, category: "documentation" }),
      ]),
      makeResult("gemini", [
        makeSuggestion({ file: "README.md", line: null, category: "documentation" }),
      ]),
    ];

    const clusters = clusterSuggestions(results);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.agreement).toBe(2);
  });

  it("sorts by agreement desc, then severity", () => {
    const results = [
      // 3-agent agreement on low severity
      makeResult("a", [makeSuggestion({ file: "x.ts", line: 1, severity: "low" })]),
      makeResult("b", [makeSuggestion({ file: "x.ts", line: 1, severity: "low" })]),
      makeResult("c", [makeSuggestion({ file: "x.ts", line: 1, severity: "low" })]),
      // 1-agent critical
      makeResult("a", [makeSuggestion({ file: "y.ts", line: 50, severity: "critical" })]),
    ];

    const clusters = clusterSuggestions(results);
    // 3-agent agreement comes first despite lower severity
    expect(clusters[0]!.file).toBe("x.ts");
    expect(clusters[0]!.agreement).toBe(3);
    expect(clusters[1]!.file).toBe("y.ts");
    expect(clusters[1]!.agreement).toBe(1);
  });

  it("handles empty results", () => {
    const clusters = clusterSuggestions([]);
    expect(clusters).toHaveLength(0);
  });

  it("skips non-success results", () => {
    const results: RunResult[] = [
      {
        agent: "codex",
        status: "timeout",
        suggestions: [],
        rawOutput: "",
        rawError: "",
        durationMs: 0,
        startedAt: new Date().toISOString(),
        error: "timed out",
      },
      makeResult("claude", [makeSuggestion()]),
    ];

    const clusters = clusterSuggestions(results);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.agents).toEqual(["claude"]);
  });

  it("deduplicates rationales per agent", () => {
    // Same agent, two suggestions in same cluster
    const results = [
      makeResult("claude", [
        makeSuggestion({ file: "a.ts", line: 10, rationale: "Issue A" }),
        makeSuggestion({ file: "a.ts", line: 12, rationale: "Issue B" }),
      ]),
    ];

    const clusters = clusterSuggestions(results);
    expect(clusters).toHaveLength(1);
    // Only one rationale per agent
    expect(clusters[0]!.rationales).toHaveLength(1);
    expect(clusters[0]!.agreement).toBe(1);
  });

  it("computes median line", () => {
    const results = [
      makeResult("a", [makeSuggestion({ file: "f.ts", line: 10 })]),
      makeResult("b", [makeSuggestion({ file: "f.ts", line: 12 })]),
      makeResult("c", [makeSuggestion({ file: "f.ts", line: 14 })]),
    ];

    const clusters = clusterSuggestions(results);
    expect(clusters[0]!.line).toBe(12);
  });
});
