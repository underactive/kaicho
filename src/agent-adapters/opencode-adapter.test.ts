import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenCodeAdapter } from "./opencode-adapter.js";

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

function textEvent(text: string): string {
  return JSON.stringify({
    type: "text",
    timestamp: Date.now(),
    sessionID: "ses_test",
    part: { type: "text", text },
  });
}

function stepEvent(type: "step_start" | "step_finish"): string {
  return JSON.stringify({
    type,
    timestamp: Date.now(),
    sessionID: "ses_test",
    part: { type: type === "step_start" ? "step-start" : "step-finish" },
  });
}

function jsonlStream(...lines: string[]): string {
  return lines.join("\n");
}

describe("OpenCodeAdapter", () => {
  describe("run", () => {
    it("parses suggestions from JSONL text events", async () => {
      const suggestions = JSON.stringify({
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
      });

      const stdout = jsonlStream(
        stepEvent("step_start"),
        textEvent(suggestions),
        stepEvent("step_finish"),
      );

      mockExecaImpl(() => Promise.resolve({
        exitCode: 0,
        stdout,
        stderr: "",
        timedOut: false,
      }));

      const adapter = new OpenCodeAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
      expect(result.agent).toBe("opencode");
    });

    it("parses suggestions from markdown in text events", async () => {
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

      const stdout = jsonlStream(
        stepEvent("step_start"),
        textEvent(`I found an issue:\n\n\`\`\`json\n${suggestions}\n\`\`\`\n\nPlease fix.`),
        stepEvent("step_finish"),
      );

      mockExecaImpl(() => Promise.resolve({
        exitCode: 0,
        stdout,
        stderr: "",
        timedOut: false,
      }));

      const adapter = new OpenCodeAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
    });

    it("prepends read-only instruction in scan mode", async () => {
      let capturedArgs: string[] = [];
      mockExecaImpl((_command: string, args?: string[]) => {
        if (args) capturedArgs = args;
        return Promise.resolve({
          exitCode: 0,
          stdout: jsonlStream(textEvent('{"suggestions":[]}')),
          stderr: "",
          timedOut: false,
        });
      });

      const adapter = new OpenCodeAdapter();
      await adapter.run("/test/repo", "scan this");

      const prompt = capturedArgs[capturedArgs.length - 1];
      expect(prompt).toMatch(/^IMPORTANT: This is a READ-ONLY analysis/);
      expect(prompt).toContain("scan this");
    });

    it("does not prepend read-only instruction in fix mode", async () => {
      let capturedArgs: string[] = [];
      mockExecaImpl((_command: string, args?: string[]) => {
        if (args) capturedArgs = args;
        return Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
        });
      });

      const adapter = new OpenCodeAdapter();
      await adapter.run("/test/repo", "fix this", "fix");

      const prompt = capturedArgs[capturedArgs.length - 1];
      expect(prompt).toBe("fix this");
    });

    it("resolves model with opencode/ prefix", async () => {
      let capturedArgs: string[] = [];
      mockExecaImpl((_command: string, args?: string[]) => {
        if (args) capturedArgs = args;
        return Promise.resolve({
          exitCode: 0,
          stdout: jsonlStream(textEvent('{"suggestions":[]}')),
          stderr: "",
          timedOut: false,
        });
      });

      const adapter = new OpenCodeAdapter({ model: "minimax-m2.5-free" });
      await adapter.run("/test/repo", "scan");

      const mIndex = capturedArgs.indexOf("-m");
      expect(mIndex).toBeGreaterThan(-1);
      expect(capturedArgs[mIndex + 1]).toBe("opencode/minimax-m2.5-free");
    });

    it("passes through model that already has provider prefix", async () => {
      let capturedArgs: string[] = [];
      mockExecaImpl((_command: string, args?: string[]) => {
        if (args) capturedArgs = args;
        return Promise.resolve({
          exitCode: 0,
          stdout: jsonlStream(textEvent('{"suggestions":[]}')),
          stderr: "",
          timedOut: false,
        });
      });

      const adapter = new OpenCodeAdapter({ model: "anthropic/claude-sonnet-4-20250514" });
      await adapter.run("/test/repo", "scan");

      const mIndex = capturedArgs.indexOf("-m");
      expect(capturedArgs[mIndex + 1]).toBe("anthropic/claude-sonnet-4-20250514");
    });

    it("uses --format json flag", async () => {
      let capturedArgs: string[] = [];
      mockExecaImpl((_command: string, args?: string[]) => {
        if (args) capturedArgs = args;
        return Promise.resolve({
          exitCode: 0,
          stdout: jsonlStream(textEvent('{"suggestions":[]}')),
          stderr: "",
          timedOut: false,
        });
      });

      const adapter = new OpenCodeAdapter();
      await adapter.run("/test/repo", "scan");

      expect(capturedArgs).toContain("--format");
      expect(capturedArgs[capturedArgs.indexOf("--format") + 1]).toBe("json");
    });

    it("never throws", async () => {
      mockExecaImpl(() => { throw new Error("fail"); });
      const adapter = new OpenCodeAdapter();
      const result = await adapter.run("/test/repo", "scan");
      expect(result.status).toBe("agent-error");
    });
  });
});
