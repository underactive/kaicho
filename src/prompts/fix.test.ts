import { describe, it, expect } from "vitest";
import { buildFixPrompt, buildRetryFixPrompt, extractFixerContext } from "./fix.js";
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

describe("buildRetryFixPrompt", () => {
  const failedDiff = `--- a/src/api.ts\n+++ b/src/api.ts\n@@ -40,3 +40,3 @@\n-const q = "SELECT * FROM " + table;\n+const q = \`SELECT * FROM \${table}\`;`;
  const concern = "Template literals still allow injection. Use parameterized queries instead.";

  it("includes the failed diff", () => {
    const prompt = buildRetryFixPrompt(makeCluster(), failedDiff, concern);
    expect(prompt).toContain("PREVIOUS FIX THAT WAS REJECTED");
    expect(prompt).toContain(failedDiff);
  });

  it("includes the reviewer concern", () => {
    const prompt = buildRetryFixPrompt(makeCluster(), failedDiff, concern);
    expect(prompt).toContain("REVIEWER'S CONCERN");
    expect(prompt).toContain("Template literals still allow injection");
  });

  it("instructs a different approach", () => {
    const prompt = buildRetryFixPrompt(makeCluster(), failedDiff, concern);
    expect(prompt).toContain("DIFFERENT, better fix");
    expect(prompt).toContain("Do NOT repeat the same approach");
  });

  it("preserves original finding context", () => {
    const prompt = buildRetryFixPrompt(makeCluster(), failedDiff, concern);
    expect(prompt).toContain("src/api.ts:42");
    expect(prompt).toContain("SEVERITY: high");
    expect(prompt).toContain("claude: SQL injection");
  });
});

describe("extractFixerContext", () => {
  it("extracts from plain text", () => {
    const output = `I fixed the SQL injection.\n<FIX_CONTEXT>\nApproach: Used parameterized queries\nAlternatives rejected: ORM was overkill\nTradeoffs: Slightly more verbose\n</FIX_CONTEXT>`;
    const ctx = extractFixerContext(output);
    expect(ctx).toContain("Used parameterized queries");
    expect(ctx).toContain("ORM was overkill");
  });

  it("extracts from Claude JSON wrapper", () => {
    const output = JSON.stringify({
      type: "result",
      result: "Done.\n<FIX_CONTEXT>\nApproach: Replaced concat with prepared statement\nAlternatives rejected: None\nTradeoffs: None\n</FIX_CONTEXT>",
    });
    const ctx = extractFixerContext(output);
    expect(ctx).toContain("Replaced concat with prepared statement");
  });

  it("extracts from Gemini JSON wrapper", () => {
    const output = JSON.stringify({
      response: "Fixed.\n<FIX_CONTEXT>\nApproach: Added input validation\nAlternatives rejected: WAF rule\nTradeoffs: Minor perf hit\n</FIX_CONTEXT>",
    });
    const ctx = extractFixerContext(output);
    expect(ctx).toContain("Added input validation");
  });

  it("returns null when no context block", () => {
    expect(extractFixerContext("just some output")).toBeNull();
    expect(extractFixerContext(JSON.stringify({ result: "no context here" }))).toBeNull();
  });
});
