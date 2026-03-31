import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeAdapter } from "./claude-adapter.js";

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

describe("ClaudeAdapter", () => {
  describe("isAvailable", () => {
    it("returns true when claude CLI is found", async () => {
      mockExeca.mockResolvedValueOnce({ exitCode: 0, stdout: "1.0.0" } as never);
      const adapter = new ClaudeAdapter();
      expect(await adapter.isAvailable()).toBe(true);
    });

    it("returns false when claude CLI is not found", async () => {
      mockExeca.mockRejectedValueOnce(new Error("ENOENT"));
      const adapter = new ClaudeAdapter();
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe("run", () => {
    it("returns success with suggestions from result text", async () => {
      const wrapper = {
        type: "result",
        subtype: "success",
        is_error: false,
        result: JSON.stringify({
          suggestions: [
            {
              file: "app.ts",
              line: 10,
              category: "security",
              severity: "high",
              rationale: "SQL injection",
              suggestedChange: "Use parameterized queries",
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

      const adapter = new ClaudeAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
      expect(result.agent).toBe("claude");
    });

    it("parses suggestions from markdown-fenced JSON in result", async () => {
      const json = JSON.stringify({
        suggestions: [
          {
            file: "api.ts",
            line: 5,
            category: "security",
            severity: "critical",
            rationale: "Hardcoded secret",
            suggestedChange: "Use env var",
          },
        ],
      }, null, 2);
      const wrapper = {
        type: "result",
        result: `Here are my findings:\n\n\`\`\`json\n${json}\n\`\`\``,
      };

      mockExecaImpl(() => Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify(wrapper),
        stderr: "",
        timedOut: false,
      }));

      const adapter = new ClaudeAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]?.severity).toBe("critical");
    });

    it("normalizes aliased field names in result", async () => {
      const wrapper = {
        type: "result",
        result: JSON.stringify({
          suggestions: [
            {
              fileName: "app.ts",
              lineNumber: 10,
              type: "security",
              level: "high",
              description: "SQL injection",
              fix: "Use parameterized queries",
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

      const adapter = new ClaudeAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]?.file).toBe("app.ts");
      expect(result.suggestions[0]?.rationale).toBe("SQL injection");
    });

    it("returns timeout status", async () => {
      mockExecaImpl(() => Promise.resolve({
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: true,
      }));

      const adapter = new ClaudeAdapter({ timeoutMs: 1000 });
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("timeout");
    });

    it("never throws", async () => {
      mockExecaImpl(() => { throw new Error("crash"); });

      const adapter = new ClaudeAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("agent-error");
      expect(result.error).toContain("crash");
    });

    it("uses --permission-mode plan for read-only and does not pass --json-schema", async () => {
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

      const adapter = new ClaudeAdapter();
      await adapter.run("/test/repo", "scan");

      expect(capturedArgs).toContain("--permission-mode");
      expect(capturedArgs).toContain("plan");
      expect(capturedArgs).not.toContain("--json-schema");
    });
  });
});
