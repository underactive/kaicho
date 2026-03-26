import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiAdapter } from "./gemini-adapter.js";

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

describe("GeminiAdapter", () => {
  describe("run", () => {
    it("parses suggestions from response field", async () => {
      const wrapper = {
        session_id: "abc",
        response: JSON.stringify({
          suggestions: [
            {
              file: "server.py",
              line: 42,
              category: "security",
              severity: "critical",
              rationale: "Command injection",
              suggestedChange: "Use subprocess with array args",
            },
          ],
        }),
        stats: {},
      };

      mockExecaImpl(() => Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify(wrapper),
        stderr: "",
        timedOut: false,
      }));

      const adapter = new GeminiAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
      expect(result.agent).toBe("gemini");
    });

    it("parses suggestions from markdown in response", async () => {
      const suggestions = JSON.stringify({
        suggestions: [
          {
            file: "app.js",
            line: 10,
            category: "security",
            severity: "high",
            rationale: "XSS vulnerability",
            suggestedChange: "Sanitize input",
          },
        ],
      }, null, 2);

      const wrapper = {
        session_id: "def",
        response: `I found an issue:\n\n\`\`\`json\n${suggestions}\n\`\`\`\n\nPlease fix this.`,
        stats: {},
      };

      mockExecaImpl(() => Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify(wrapper),
        stderr: "",
        timedOut: false,
      }));

      const adapter = new GeminiAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
    });

    it("uses --sandbox flag", async () => {
      let capturedArgs: string[] = [];
      mockExecaImpl((command: string, args?: string[]) => {
        if (args) capturedArgs = args;
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({ response: '{"suggestions":[]}' }),
          stderr: "",
          timedOut: false,
        });
      });

      const adapter = new GeminiAdapter();
      await adapter.run("/test/repo", "scan");

      expect(capturedArgs).toContain("--sandbox");
    });

    it("never throws", async () => {
      mockExecaImpl(() => { throw new Error("fail"); });
      const adapter = new GeminiAdapter();
      const result = await adapter.run("/test/repo", "scan");
      expect(result.status).toBe("agent-error");
    });
  });
});
