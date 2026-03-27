import { describe, it, expect } from "vitest";
import { buildFixPrompt } from "./fix.js";
import type { SuggestionCluster } from "../dedup/index.js";

function makeCluster(overrides: Partial<SuggestionCluster> = {}): SuggestionCluster {
  return {
    id: "a1b2",
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

describe("buildFixPrompt", () => {
  it("includes file and line in prompt", () => {
    const prompt = buildFixPrompt(makeCluster());
    expect(prompt).toContain("src/api.ts:42");
    expect(prompt).toContain("SEVERITY: high");
    expect(prompt).toContain("CATEGORY: security");
  });

  it("includes rationales from all agents", () => {
    const prompt = buildFixPrompt(makeCluster());
    expect(prompt).toContain("claude: SQL injection");
    expect(prompt).toContain("codex: User input interpolated");
  });

  it("includes suggested change when present", () => {
    const prompt = buildFixPrompt(makeCluster());
    expect(prompt).toContain("Use parameterized queries");
  });

  it("omits suggested change section when null", () => {
    const prompt = buildFixPrompt(makeCluster({ suggestedChange: null }));
    expect(prompt).not.toContain("Suggested fix:");
  });

  it("handles null line", () => {
    const prompt = buildFixPrompt(makeCluster({ line: null }));
    expect(prompt).toContain("ISSUE LOCATION: src/api.ts");
    expect(prompt).not.toContain(":null");
  });

  it("instructs minimal changes", () => {
    const prompt = buildFixPrompt(makeCluster());
    expect(prompt).toContain("minimal, targeted fix");
    expect(prompt).toContain("Do NOT refactor");
  });
});
