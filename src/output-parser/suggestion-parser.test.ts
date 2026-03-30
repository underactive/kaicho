import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseFromFile, parseFromJsonl, parseFromText } from "./suggestion-parser.js";

const fixturesDir = path.resolve(import.meta.dirname, "../../tests/fixtures");

async function readFixture(name: string): Promise<string> {
  return fs.readFile(path.join(fixturesDir, name), "utf-8");
}

describe("parseFromFile", () => {
  it("parses valid suggestions", async () => {
    const content = await readFixture("codex-success.json");
    const result = parseFromFile(content);

    expect(result.suggestions).toHaveLength(3);
    expect(result.rejected).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.suggestions[0]).toMatchObject({
      file: "src/api/auth.ts",
      line: 42,
      category: "security",
      severity: "critical",
    });
  });

  it("handles null line values", async () => {
    const content = await readFixture("codex-success.json");
    const result = parseFromFile(content);

    const nullLineSuggestion = result.suggestions.find(
      (s) => s.file === "src/utils/crypto.ts",
    );
    expect(nullLineSuggestion?.line).toBeNull();
  });

  it("returns empty for malformed JSON", async () => {
    const content = await readFixture("codex-malformed.json");
    const result = parseFromFile(content);

    expect(result.suggestions).toHaveLength(0);
    expect(result.errors).toContain("Invalid JSON in output file");
  });

  it("returns empty suggestions for empty array", async () => {
    const content = await readFixture("codex-empty.json");
    const result = parseFromFile(content);

    expect(result.suggestions).toHaveLength(0);
    expect(result.rejected).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("keeps valid and rejects invalid in mixed input", async () => {
    const content = await readFixture("codex-partial.json");
    const result = parseFromFile(content);

    expect(result.suggestions).toHaveLength(2);
    expect(result.rejected).toBe(2);
    expect(result.suggestions[0]?.file).toBe("src/api/routes.ts");
    expect(result.suggestions[1]?.file).toBe("src/server.ts");
  });

  it("normalizes capitalized category and severity values", () => {
    const content = JSON.stringify({ suggestions: [
      { file: "src/a.ts", line: 10, category: "Bug", severity: "Medium", rationale: "test", suggestedChange: null },
      { file: "src/b.ts", line: 20, category: "Security", severity: "High", rationale: "test", suggestedChange: null },
    ]});
    const result = parseFromFile(content);

    expect(result.suggestions).toHaveLength(2);
    expect(result.rejected).toBe(0);
    expect(result.suggestions[0]!.category).toBe("bug");
    expect(result.suggestions[0]!.severity).toBe("medium");
    expect(result.suggestions[1]!.category).toBe("security");
    expect(result.suggestions[1]!.severity).toBe("high");
  });

  it("handles empty string", () => {
    const result = parseFromFile("");
    expect(result.suggestions).toHaveLength(0);
    expect(result.errors).toContain("Empty output file");
  });

  it("handles bare array input", () => {
    const content = JSON.stringify([
      {
        file: "test.ts",
        line: 1,
        category: "security",
        severity: "low",
        rationale: "Test finding",
        suggestedChange: null,
      },
    ]);
    const result = parseFromFile(content);
    expect(result.suggestions).toHaveLength(1);
  });
});

describe("parseFromJsonl", () => {
  it("extracts suggestions from item.completed events", () => {
    const jsonl = [
      JSON.stringify({ type: "thread.started", thread_id: "abc" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: JSON.stringify({
            suggestions: [
              {
                file: "app.py",
                line: 42,
                category: "security",
                severity: "high",
                rationale: "SQL injection via string concatenation",
                suggestedChange: "Use parameterized queries",
              },
            ],
          }),
        },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    ].join("\n");

    const result = parseFromJsonl(jsonl);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.severity).toBe("high");
  });

  it("returns empty for stream with no suggestions", () => {
    const jsonl = [
      JSON.stringify({ type: "thread.started" }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");

    const result = parseFromJsonl(jsonl);
    expect(result.suggestions).toHaveLength(0);
  });

  it("handles empty string", () => {
    const result = parseFromJsonl("");
    expect(result.suggestions).toHaveLength(0);
    expect(result.errors).toContain("Empty JSONL stream");
  });
});

const VALID_SUGGESTION = {
  file: "app.ts",
  line: 10,
  category: "security",
  severity: "high",
  rationale: "SQL injection risk",
  suggestedChange: "Use parameterized queries",
};

describe("parseFromText", () => {
  it("parses pure JSON text", () => {
    const text = JSON.stringify({ suggestions: [VALID_SUGGESTION] });
    const result = parseFromText(text);
    expect(result.suggestions).toHaveLength(1);
  });

  it("extracts JSON from markdown code fence", () => {
    const text = `Here are my findings:\n\n\`\`\`json\n${JSON.stringify({ suggestions: [VALID_SUGGESTION] }, null, 2)}\n\`\`\`\n\nLet me know if you need more details.`;
    const result = parseFromText(text);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.severity).toBe("high");
  });

  it("extracts JSON from unmarked code fence", () => {
    const text = `Results:\n\`\`\`\n${JSON.stringify({ suggestions: [VALID_SUGGESTION] })}\n\`\`\``;
    const result = parseFromText(text);
    expect(result.suggestions).toHaveLength(1);
  });

  it("extracts JSON object embedded in prose", () => {
    const text = `I found the following issues: {"suggestions": [${JSON.stringify(VALID_SUGGESTION)}]} and that's all.`;
    const result = parseFromText(text);
    expect(result.suggestions).toHaveLength(1);
  });

  it("handles empty text", () => {
    const result = parseFromText("");
    expect(result.suggestions).toHaveLength(0);
    expect(result.errors).toContain("Empty text response");
  });

  it("handles text with no JSON", () => {
    const result = parseFromText("I found no security issues in this codebase.");
    expect(result.suggestions).toHaveLength(0);
    expect(result.errors).toContain("No JSON found in text response");
  });

  it("handles bare array in text", () => {
    const text = `Here: [${JSON.stringify(VALID_SUGGESTION)}]`;
    const result = parseFromText(text);
    expect(result.suggestions).toHaveLength(1);
  });
});
