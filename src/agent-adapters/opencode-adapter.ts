import { execa } from "execa";
import type { AgentAdapter, AgentConfig, AgentMode, RunResult } from "../types/index.js";
import { DEFAULT_TIMEOUT_MS } from "../config/index.js";
import { parseFromText } from "../output-parser/index.js";
import { log } from "../logger/index.js";

const READ_ONLY_PREFIX =
  "IMPORTANT: This is a READ-ONLY analysis. Do NOT modify, create, or delete any files. Only read and analyze.\n\n";

export class OpenCodeAdapter implements AgentAdapter {
  readonly config: AgentConfig;

  constructor(config?: Partial<AgentConfig>) {
    this.config = {
      name: "opencode",
      command: "opencode",
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
      const effectivePrompt =
        mode === "scan" || mode === "review"
          ? READ_ONLY_PREFIX + prompt
          : prompt;

      const args = ["run", "--format", "json"];

      if (this.config.model) {
        args.push("-m", this.resolveModel(this.config.model));
      }

      args.push(effectivePrompt);

      log("info", "Starting OpenCode agent", { repoPath });

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

  /** Prepend `opencode/` when the model string has no provider prefix. */
  private resolveModel(model: string): string {
    if (model.includes("/")) return model;
    return `opencode/${model}`;
  }

  private parseOutput(
    stdout: string,
    stderr: string,
    durationMs: number,
    startedAt: string,
  ): RunResult {
    const responseText = this.extractTextFromEvents(stdout);

    const textToParse = responseText ?? stdout;

    if (!textToParse.trim()) {
      return {
        agent: this.config.name,
        status: "parse-error",
        suggestions: [],
        rawOutput: stdout,
        rawError: stderr,
        durationMs,
        startedAt,
        error: "No response text in OpenCode output",
      };
    }

    const parseResult = parseFromText(textToParse);

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

  /**
   * Extract text from OpenCode JSONL event stream.
   * Events with `type === "text"` carry the response in `part.text`.
   */
  private extractTextFromEvents(stdout: string): string | null {
    if (!stdout.trim()) return null;

    const textParts: string[] = [];
    const lines = stdout.trim().split("\n");

    for (const line of lines) {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event["type"] === "text") {
        const part = event["part"] as Record<string, unknown> | undefined;
        if (part?.["type"] === "text" && typeof part["text"] === "string") {
          textParts.push(part["text"]);
        }
      }

      if (event["type"] === "error" || event["type"] === "session.error") {
        const errorData = event["error"] as Record<string, unknown> | undefined;
        const msg =
          (errorData?.["message"] as string) ??
          ((errorData?.["data"] as Record<string, unknown> | undefined)?.["message"] as string);
        if (msg) {
          log("warn", "OpenCode session error", { error: msg });
        }
      }
    }

    return textParts.length > 0 ? textParts.join("") : null;
  }
}
