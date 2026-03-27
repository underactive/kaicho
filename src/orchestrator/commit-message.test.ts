import { describe, it, expect } from "vitest";
import { buildCommitMessage } from "./commit-message.js";
import type { SuggestionCluster } from "../dedup/index.js";

function makeCluster(overrides: Partial<SuggestionCluster> = {}): SuggestionCluster {
  return {
    id: "a1b2c3",
    file: "src/api.ts",
    line: 42,
    category: "security",
    severity: "high",
    agents: ["claude", "codex"],
    agreement: 2,
    rationales: [
      { agent: "claude", rationale: "SQL injection via string concatenation" },
      { agent: "codex", rationale: "User input interpolated into query" },
    ],
    suggestedChange: "Use parameterized queries",
    items: [],
    ...overrides,
  };
}

describe("buildCommitMessage", () => {
  it("uses summary as title when available", () => {
    const msg = buildCommitMessage(
      makeCluster({ summary: "SQL injection in query builder" }),
      "claude",
    );
    expect(msg).toMatch(/^fix\(a1b2c3\): SQL injection in query builder/);
  });

  it("truncates first rationale as title when no summary", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toMatch(/^fix\(a1b2c3\): SQL injection via string concatenation/);
  });

  it("truncates long titles to 72 chars", () => {
    const longRationale = "A".repeat(100);
    const msg = buildCommitMessage(
      makeCluster({ rationales: [{ agent: "a", rationale: longRationale }] }),
      "claude",
    );
    const title = msg.split("\n")[0]!;
    // fix(a1b2c3): + 72 chars max for the rationale part
    expect(title.length).toBeLessThanOrEqual(85);
    expect(title).toContain("…");
  });

  it("includes file location with line", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toContain("File: src/api.ts:42");
  });

  it("includes file location without line", () => {
    const msg = buildCommitMessage(makeCluster({ line: null }), "claude");
    expect(msg).toContain("File: src/api.ts");
    expect(msg).not.toContain(":null");
  });

  it("includes severity and category", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toContain("Severity: high | Category: security");
  });

  it("includes agent agreement count", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toContain("Found by: claude, codex (2x agreement)");
  });

  it("includes rationales from each agent", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toContain("claude: SQL injection via string concatenation");
    expect(msg).toContain("codex: User input interpolated into query");
  });

  it("includes suggested change when present", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toContain("Suggested change: Use parameterized queries");
  });

  it("omits suggested change when null", () => {
    const msg = buildCommitMessage(makeCluster({ suggestedChange: null }), "claude");
    expect(msg).not.toContain("Suggested change:");
  });

  it("includes applied-by footer", () => {
    const msg = buildCommitMessage(makeCluster(), "codex");
    expect(msg).toContain("Applied by Kaichō via Codex");
  });
});
