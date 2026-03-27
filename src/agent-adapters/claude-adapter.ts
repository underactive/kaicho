import { execa } from "execa";
import type { AgentAdapter, AgentConfig, AgentMode, RunResult } from "../types/index.js";
import { DEFAULT_TIMEOUT_MS } from "../config/index.js";
import { parseFromFile } from "../output-parser/index.js";
import { SUGGESTIONS_JSON_SCHEMA } from "../prompts/index.js";
import { log } from "../logger/index.js";

export class ClaudeAdapter implements AgentAdapter {
  readonly config: AgentConfig;

  constructor(config?: Partial<AgentConfig>) {
    this.config = {
      name: "claude",
      command: "claude",
      timeoutMs: DEFAULT_TIMEOUT_MS,
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

  async run(repoPath: string, prompt: string, mode: AgentMode = "scan"): Promise<RunResult> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    try {
      const args: string[] = [
        "-p", prompt,
        "--output-format", "json",
        "--no-session-persistence",
      ];

      if (this.config.model) {
        args.push("--model", this.config.model);
      }

      if (mode === "scan") {
        args.push("--json-schema", JSON.stringify(SUGGESTIONS_JSON_SCHEMA));
        args.push("--permission-mode", "plan");
      } else if (mode === "review") {
        args.push("--permission-mode", "plan"); // read-only, no schema
      } else {
        args.push("--permission-mode", "acceptEdits");
      }

      log("info", "Starting Claude agent", { repoPath });

      const subprocess = execa(this.config.command, args, {
        cwd: repoPath,
        timeout: this.config.timeoutMs,
        reject: false,
      });

      if (this.config.verbose && subprocess.stderr) {
        subprocess.stderr.pipe(process.stderr, { end: false });
      }

      const result = await subprocess;

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

      // Fix/review mode: no structured output to parse
      if (mode === "fix" || mode === "review") {
        return {
          agent: this.config.name,
          status: "success",
          suggestions: [],
          rawOutput: result.stdout,
          rawError: result.stderr,
          durationMs,
          startedAt,
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
    // Parse the Claude CLI JSON wrapper
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
        error: "Failed to parse Claude CLI JSON wrapper",
      };
    }

    // structured_output is an already-parsed object when --json-schema is used
    const structured = wrapper["structured_output"];
    if (structured && typeof structured === "object") {
      const content = JSON.stringify(structured);
      const parseResult = parseFromFile(content);

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

    // Fallback: try result field (text content without schema enforcement)
    const resultText = wrapper["result"];
    if (typeof resultText === "string" && resultText.trim()) {
      const parseResult = parseFromFile(resultText);
      if (parseResult.suggestions.length > 0) {
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

    return {
      agent: this.config.name,
      status: "parse-error",
      suggestions: [],
      rawOutput: stdout,
      rawError: stderr,
      durationMs,
      startedAt,
      error: "No structured_output or parseable result in Claude response",
    };
  }
}
