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
    expect(msg).toMatch(/^fix: SQL injection in query builder/);
  });

  it("truncates first rationale as title when no summary", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toMatch(/^fix: SQL injection via string concatenation/);
  });

  it("does not include cluster ID in subject line", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    const title = msg.split("\n")[0]!;
    expect(title).not.toContain("a1b2c3");
  });

  it("includes Kaichō ref in description header", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toContain("Kaichō ref: a1b2c3");
  });

  it("truncates long titles to 72 chars", () => {
    const longRationale = "A".repeat(100);
    const msg = buildCommitMessage(
      makeCluster({ rationales: [{ agent: "a", rationale: longRationale }] }),
      "claude",
    );
    const title = msg.split("\n")[0]!;
    // fix: + 72 chars max for the rationale part
    expect(title.length).toBeLessThanOrEqual(78);
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

  it("includes found-by with capitalized agent names and agreement", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toContain("Found by: Claude, Codex {2x agreement}");
  });

  it("omits agreement for single-agent findings", () => {
    const msg = buildCommitMessage(makeCluster({ agents: ["claude"], agreement: 1 }), "claude");
    expect(msg).toContain("Found by: Claude");
    expect(msg).not.toContain("agreement");
  });

  it("includes scan models in found-by when provided", () => {
    const msg = buildCommitMessage(makeCluster(), "claude", undefined, {
      claude: "sonnet-4-6",
      codex: "gpt-5.4-mini",
    });
    expect(msg).toContain("Found by: Claude (sonnet-4-6), Codex (gpt-5.4-mini) {2x agreement}");
  });

  it("includes rationales from each agent", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toContain("Claude: SQL injection via string concatenation");
    expect(msg).toContain("Codex: User input interpolated into query");
  });

  it("includes suggested change when present", () => {
    const msg = buildCommitMessage(makeCluster(), "claude");
    expect(msg).toContain("Suggested change: Use parameterized queries");
  });

  it("omits suggested change when null", () => {
    const msg = buildCommitMessage(makeCluster({ suggestedChange: null }), "claude");
    expect(msg).not.toContain("Suggested change:");
  });

  it("includes signature footer without reviewer", () => {
    const msg = buildCommitMessage(makeCluster(), "codex");
    expect(msg).toContain("Fixed by Codex, applied via Kaichō");
  });

  it("includes model in signature", () => {
    const msg = buildCommitMessage(makeCluster(), "cursor", "composer-2");
    expect(msg).toContain("Fixed by Cursor (composer-2), applied via Kaichō");
  });

  it("includes reviewer in signature", () => {
    const msg = buildCommitMessage(makeCluster(), "codex", "gpt-5.4", undefined, {
      name: "claude",
      model: "opus-4-6",
    });
    expect(msg).toContain("Fixed by Codex (gpt-5.4) and reviewed by Claude (opus-4-6), applied via Kaichō");
  });

  it("includes reviewer without model", () => {
    const msg = buildCommitMessage(makeCluster(), "codex", undefined, undefined, {
      name: "cursor",
    });
    expect(msg).toContain("Fixed by Codex and reviewed by Cursor, applied via Kaichō");
  });

  it("strips inline model specifier from agent display name", () => {
    const msg = buildCommitMessage(makeCluster(), "cursor:comp", "composer-2");
    expect(msg).toContain("Fixed by Cursor (composer-2), applied via Kaichō");
  });

  it("falls back to inline model specifier when no explicit model provided", () => {
    const msg = buildCommitMessage(makeCluster(), "cursor:comp");
    expect(msg).toContain("Fixed by Cursor (comp), applied via Kaichō");
  });

  it("strips inline model specifier from reviewer display name", () => {
    const msg = buildCommitMessage(makeCluster(), "cursor", "composer-2", undefined, {
      name: "claude:sonnet[1m]",
    });
    expect(msg).toContain("reviewed by Claude (sonnet[1m])");
  });
});
