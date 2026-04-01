import { execa } from "execa";
import type { AgentAdapter, AgentConfig, AgentMode, RunResult } from "../types/index.js";
import { DEFAULT_TIMEOUT_MS } from "../config/index.js";
import { parseFromText } from "../output-parser/index.js";
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

      const runResult = this.parseOutput(result.stdout, result.stderr, durationMs, startedAt);

      // Retry: if scan parse failed, ask Claude to reformat the prose as JSON
      if (mode === "scan" && runResult.status === "parse-error" && runResult.rawOutput) {
        try {
          const w = JSON.parse(runResult.rawOutput) as Record<string, unknown>;
          const prose = typeof w["result"] === "string" ? w["result"] : null;
          if (prose?.trim()) {
            log("warn", "Scan parse failed, attempting reformat retry", {
              originalError: runResult.error, rawOutputLength: prose.length,
            });
            const retryResult = await this.retryReformat(repoPath, prose, startMs, startedAt);
            if (retryResult) return retryResult;
          }
        } catch { /* no retry if wrapper is unparseable */ }
      }

      return runResult;
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

    // Defensive: if structured_output exists (e.g. leftover --json-schema),
    // stringify it and parse as text
    const structured = wrapper["structured_output"];
    if (structured && typeof structured === "object") {
      const parseResult = parseFromText(JSON.stringify(structured));
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

    // Primary: freeform text in the result field
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
        error: "No result text in Claude response",
      };
    }

    const parseResult = parseFromText(resultText);

    if (parseResult.suggestions.length === 0 && parseResult.errors.length > 0) {
      log("warn", "Claude scan parse failed", {
        error: parseResult.errors.join("; "),
        rawOutputPreview: resultText.slice(0, 500),
      });
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

  private async retryReformat(
    repoPath: string,
    proseText: string,
    startMs: number,
    startedAt: string,
  ): Promise<RunResult | null> {
    const reformatPrompt = `Extract all security/code findings from the analysis below and return them as a JSON object.

Use this exact structure:
{"suggestions": [{"file": "...", "line": ..., "category": "...", "severity": "...", "rationale": "...", "suggestedChange": "..."}]}

category must be one of: security, bug, performance, maintainability, style, documentation
severity must be one of: critical, high, medium, low, info
line should be a number or null
suggestedChange should be a string or null

Return ONLY the JSON object, no other text.

Analysis to extract from:
${proseText}`;

    try {
      const args = [
        "-p", reformatPrompt,
        "--output-format", "json",
        "--no-session-persistence",
        "--permission-mode", "plan",
      ];

      if (this.config.model) {
        args.push("--model", this.config.model);
      }

      log("info", "Starting Claude reformat retry", { repoPath });

      const result = await execa(this.config.command, args, {
        cwd: repoPath,
        timeout: 120_000, // 2 min cap for reformat
        reject: false,
      });

      const durationMs = Date.now() - startMs;

      if (result.timedOut || result.exitCode !== 0) {
        log("warn", "Claude reformat retry failed", {
          timedOut: result.timedOut,
          exitCode: result.exitCode,
        });
        return null;
      }

      let wrapper: Record<string, unknown>;
      try {
        wrapper = JSON.parse(result.stdout) as Record<string, unknown>;
      } catch {
        return null;
      }

      const resultText = wrapper["result"];
      if (typeof resultText !== "string" || !resultText.trim()) return null;

      const parseResult = parseFromText(resultText);
      if (parseResult.suggestions.length === 0) return null;

      log("info", "Claude reformat retry succeeded", {
        suggestions: parseResult.suggestions.length,
      });

      return {
        agent: this.config.name,
        status: "success",
        suggestions: parseResult.suggestions,
        rawOutput: result.stdout,
        rawError: result.stderr,
        durationMs: Date.now() - startMs,
        startedAt,
      };
    } catch {
      return null;
    }
  }
}
