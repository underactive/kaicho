import { execa } from "execa";
import type { AgentAdapter, AgentConfig, RunResult } from "../types/index.js";
import { parseFromText } from "../output-parser/index.js";
import { log } from "../logger/index.js";

export class CursorAdapter implements AgentAdapter {
  readonly config: AgentConfig;

  constructor(config?: Partial<AgentConfig>) {
    this.config = {
      name: "cursor",
      command: "agent",
      timeoutMs: 300_000,
      ...config,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa(this.config.command, ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async run(repoPath: string, prompt: string): Promise<RunResult> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    try {
      const args = [
        "-p", prompt,
        "--output-format", "json",
        "--trust",
        "--mode", "plan", // read-only: no file edits
      ];

      log("info", "Starting Cursor agent", { repoPath });

      const result = await execa(this.config.command, args, {
        cwd: repoPath,
        timeout: this.config.timeoutMs,
        reject: false,
      });

      const durationMs = Date.now() - startMs;

      if (result.timedOut) {
        return {
          agent: this.config.name,
          status: "timeout",
          suggestions: [],
          rawOutput: result.stdout,
          rawError: result.stderr,
          durationMs,
          startedAt,
          error: `Agent timed out after ${this.config.timeoutMs}ms`,
        };
      }

      if (result.exitCode !== 0) {
        return {
          agent: this.config.name,
          status: "agent-error",
          suggestions: [],
          rawOutput: result.stdout,
          rawError: result.stderr,
          durationMs,
          startedAt,
          error: `Agent exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
        };
      }

      return this.parseOutput(result.stdout, result.stderr, durationMs, startedAt);
    } catch (err) {
      const durationMs = Date.now() - startMs;
      return {
        agent: this.config.name,
        status: "agent-error",
        suggestions: [],
        rawOutput: "",
        rawError: String(err),
        durationMs,
        startedAt,
        error: `Unexpected error: ${String(err)}`,
      };
    }
  }

  private parseOutput(
    stdout: string,
    stderr: string,
    durationMs: number,
    startedAt: string,
  ): RunResult {
    // Cursor agent JSON wrapper: { type, result, ... }
    let wrapper: Record<string, unknown>;
    try {
      wrapper = JSON.parse(stdout);
    } catch {
      return {
        agent: this.config.name,
        status: "parse-error",
        suggestions: [],
        rawOutput: stdout,
        rawError: stderr,
        durationMs,
        startedAt,
        error: "Failed to parse Cursor agent JSON wrapper",
      };
    }

    // No schema enforcement — result is freeform text containing JSON
    const resultText = wrapper["result"];
    if (typeof resultText !== "string" || !resultText.trim()) {
      return {
        agent: this.config.name,
        status: "parse-error",
        suggestions: [],
        rawOutput: stdout,
        rawError: stderr,
        durationMs,
        startedAt,
        error: "No result text in Cursor response",
      };
    }

    const parseResult = parseFromText(resultText);

    if (parseResult.suggestions.length === 0 && parseResult.errors.length > 0) {
      return {
        agent: this.config.name,
        status: "parse-error",
        suggestions: [],
        rawOutput: stdout,
        rawError: stderr,
        durationMs,
        startedAt,
        error: parseResult.errors.join("; "),
      };
    }

    return {
      agent: this.config.name,
      status: "success",
      suggestions: parseResult.suggestions,
      rawOutput: stdout,
      rawError: stderr,
      durationMs,
      startedAt,
    };
  }
}
