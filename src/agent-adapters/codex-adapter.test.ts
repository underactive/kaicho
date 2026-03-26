import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodexAdapter } from "./codex-adapter.js";

// Mock execa at the module level
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

// Mock fs for output file reading
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdtemp: vi.fn().mockResolvedValue("/tmp/kaicho-test"),
    rm: vi.fn(),
  };
});

import { execa } from "execa";
import * as fs from "node:fs/promises";

const mockExeca = vi.mocked(execa);
const mockReadFile = vi.mocked(fs.readFile);

function mockExecaImpl(fn: (command: string, args?: string[]) => unknown): void {
  mockExeca.mockImplementation(fn as unknown as typeof execa);
}

function gitOk(command: string): unknown {
  if (command === "git") {
    return Promise.resolve({ exitCode: 0, stdout: "true", stderr: "" });
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: git repo check succeeds, codex returns empty success
  mockExecaImpl((command: string) => {
    return gitOk(command) ?? Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    });
  });
});

describe("CodexAdapter", () => {
  describe("isAvailable", () => {
    it("returns true when codex CLI is found", async () => {
      mockExeca.mockResolvedValueOnce({
        exitCode: 0,
        stdout: "0.1.0",
        stderr: "",
      } as never);

      const adapter = new CodexAdapter();
      expect(await adapter.isAvailable()).toBe(true);
    });

    it("returns false when codex CLI is not found", async () => {
      mockExeca.mockRejectedValueOnce(new Error("ENOENT"));

      const adapter = new CodexAdapter();
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe("run", () => {
    it("returns success with parsed suggestions from -o file", async () => {
      const suggestions = {
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
      };

      mockExecaImpl((command: string) => {
        return gitOk(command) ?? Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
        });
      });

      mockReadFile.mockResolvedValueOnce(JSON.stringify(suggestions));

      const adapter = new CodexAdapter();
      const result = await adapter.run("/test/repo", "scan for security issues");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]?.severity).toBe("high");
      expect(result.agent).toBe("codex");
    });

    it("returns timeout status when agent times out", async () => {
      mockExecaImpl((command: string) => {
        return gitOk(command) ?? Promise.resolve({
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: true,
        });
      });

      const adapter = new CodexAdapter({ timeoutMs: 1000 });
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("timeout");
      expect(result.error).toContain("timed out");
    });

    it("returns agent-error on non-zero exit code", async () => {
      mockExecaImpl((command: string) => {
        return gitOk(command) ?? Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "Authentication failed",
          timedOut: false,
        });
      });

      const adapter = new CodexAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("agent-error");
      expect(result.error).toContain("Authentication failed");
    });

    it("never throws even on unexpected errors", async () => {
      mockExecaImpl((command: string) => {
        if (command === "git") {
          return Promise.resolve({ exitCode: 0, stdout: "true", stderr: "" });
        }
        throw new Error("Unexpected crash");
      });

      const adapter = new CodexAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("agent-error");
      expect(result.error).toContain("Unexpected");
    });

    it("uses array-form arguments (no shell interpolation)", async () => {
      let capturedArgs: string[] = [];

      mockExecaImpl((command: string, args?: string[]) => {
        if (command === "git") {
          return Promise.resolve({ exitCode: 0, stdout: "true", stderr: "" });
        }
        if (command === "codex" && args) {
          capturedArgs = args;
        }
        return Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
        });
      });

      mockReadFile.mockResolvedValueOnce(JSON.stringify({ suggestions: [] }));

      const adapter = new CodexAdapter();
      await adapter.run("/test/repo", "scan for issues");

      expect(capturedArgs[0]).toBe("exec");
      expect(capturedArgs).toContain("-s");
      expect(capturedArgs).toContain("read-only");
      expect(capturedArgs).toContain("--ephemeral");
      expect(capturedArgs).toContain("--output-schema");
      expect(capturedArgs).toContain("-o");
      // Prompt is the last argument, not interpolated
      expect(capturedArgs[capturedArgs.length - 1]).toBe("scan for issues");
    });

    it("falls back to JSONL parsing when -o file is empty", async () => {
      const jsonl = [
        JSON.stringify({ type: "thread.started", thread_id: "abc" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_0",
            type: "agent_message",
            text: JSON.stringify({
              suggestions: [
                {
                  file: "test.ts",
                  line: 1,
                  category: "security",
                  severity: "low",
                  rationale: "Minor issue",
                  suggestedChange: null,
                },
              ],
            }),
          },
        }),
      ].join("\n");

      mockExecaImpl((command: string) => {
        return gitOk(command) ?? Promise.resolve({
          exitCode: 0,
          stdout: jsonl,
          stderr: "",
          timedOut: false,
        });
      });

      // -o file is empty
      mockReadFile.mockResolvedValueOnce("");

      const adapter = new CodexAdapter();
      const result = await adapter.run("/test/repo", "scan");

      expect(result.status).toBe("success");
      expect(result.suggestions).toHaveLength(1);
    });
  });
});
