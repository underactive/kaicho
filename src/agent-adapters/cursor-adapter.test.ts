import { describe, it, expect, vi, beforeEach } from "vitest";
import { CursorAdapter } from "./cursor-adapter.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";

const mockExeca = vi.mocked(execa);

function mockExecaImpl(fn: (command: string, args?: string[]) => unknown): void {
  mockExeca.mockImplementation(fn as unknown as typeof execa);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CursorAdapter", () => {
  it("uses 'agent' as the CLI command", () => {
    const adapter = new CursorAdapter();
    expect(adapter.config.command).toBe("agent");
  });

  describe("run", () => {
    it("parses suggestions from JSON in result text", async () => {
      const wrapper = {
        type: "result",
        subtype: "success",
        result: JSON.stringify({
          suggestions: [
            {
              file: "app.ts",
              line: 5,
              category: "security",
              severity: "medium",
              rationale: "Hardcoded secret",
              suggestedChange: "Use env var",
            },
          ],
        }),
      };

      mockExecaImpl(() => Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify(wrapper),
        stderr: "",
        timedOut: false,
      }));

      const adapter = new CursorAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
      expect(result.agent).toBe("cursor");
    });

    it("parses suggestions from markdown-fenced JSON", async () => {
      const suggestions = JSON.stringify({
        suggestions: [
          {
            file: "index.ts",
            line: 1,
            category: "security",
            severity: "low",
            rationale: "Minor issue",
            suggestedChange: null,
          },
        ],
      }, null, 2);

      const wrapper = {
        type: "result",
        result: `Here are my findings:\n\n\`\`\`json\n${suggestions}\n\`\`\``,
      };

      mockExecaImpl(() => Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify(wrapper),
        stderr: "",
        timedOut: false,
      }));

      const adapter = new CursorAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
    });

    it("uses --mode plan and --trust flags", async () => {
      let capturedArgs: string[] = [];
      mockExecaImpl((command: string, args?: string[]) => {
        if (args) capturedArgs = args;
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({ result: '{"suggestions":[]}' }),
          stderr: "",
          timedOut: false,
        });
      });

      const adapter = new CursorAdapter();
      await adapter.run("/test/repo", "scan");

      expect(capturedArgs).toContain("--trust");
      expect(capturedArgs).toContain("--mode");
      expect(capturedArgs).toContain("plan");
    });

    it("never throws", async () => {
      mockExecaImpl(() => { throw new Error("boom"); });
      const adapter = new CursorAdapter();
      const result = await adapter.run("/test/repo", "scan");
      expect(result.status).toBe("agent-error");
    });
  });
});
