import { describe, it, expect } from "vitest";
import { buildValidationPrompt, pickReviewer } from "./validate.js";
import type { SuggestionCluster } from "../dedup/index.js";

function makeCluster(overrides: Partial<SuggestionCluster> = {}): SuggestionCluster {
  return {
    id: "abc123",
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

describe("buildValidationPrompt", () => {
  it("includes the original finding location", () => {
    const prompt = buildValidationPrompt(makeCluster(), "diff content");
    expect(prompt).toContain("src/api.ts:42");
  });

  it("includes the diff", () => {
    const prompt = buildValidationPrompt(makeCluster(), "+added line\n-removed line");
    expect(prompt).toContain("+added line");
    expect(prompt).toContain("-removed line");
  });

  it("includes rationales from all agents", () => {
    const prompt = buildValidationPrompt(makeCluster(), "diff");
    expect(prompt).toContain("claude: SQL injection");
    expect(prompt).toContain("codex: User input interpolated");
  });

  it("asks for approve/concern verdict", () => {
    const prompt = buildValidationPrompt(makeCluster(), "diff");
    expect(prompt).toContain('"approve"');
    expect(prompt).toContain('"concern"');
  });
});

describe("pickReviewer", () => {
  it("picks a different agent from the cluster agents", () => {
    const reviewer = pickReviewer("claude", ["claude", "codex"], ["claude", "codex", "cursor", "gemini"]);
    expect(reviewer).toBe("codex");
  });

  it("falls back to any available agent", () => {
    const reviewer = pickReviewer("claude", ["claude"], ["claude", "gemini"]);
    expect(reviewer).toBe("gemini");
  });

  it("returns null when only one agent exists", () => {
    const reviewer = pickReviewer("claude", ["claude"], ["claude"]);
    expect(reviewer).toBeNull();
  });

  it("prefers cluster agents over other agents", () => {
    const reviewer = pickReviewer("claude", ["claude", "codex"], ["claude", "codex", "cursor", "gemini"]);
    // codex is in the cluster and not the fixer — should be preferred
    expect(reviewer).toBe("codex");
  });
});
