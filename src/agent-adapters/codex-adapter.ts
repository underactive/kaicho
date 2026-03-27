import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execa } from "execa";
import type { AgentAdapter, AgentConfig, AgentMode, RunResult } from "../types/index.js";
import { parseFromFile, parseFromJsonl } from "../output-parser/index.js";
import { SUGGESTIONS_JSON_SCHEMA } from "../prompts/index.js";
import { log } from "../logger/index.js";

async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    await execa("git", ["-C", dirPath, "rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export class CodexAdapter implements AgentAdapter {
  readonly config: AgentConfig;

  constructor(config?: Partial<AgentConfig>) {
    this.config = {
      name: "codex",
      command: "codex",
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

  async run(repoPath: string, prompt: string, mode: AgentMode = "scan"): Promise<RunResult> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const absRepoPath = path.resolve(repoPath);

    // Create temp files for schema input and output capture
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaicho-"));
    const schemaPath = path.join(tmpDir, "schema.json");
    const outputPath = path.join(tmpDir, "output.json");

    try {
      const args: string[] = ["exec"];

      if (mode === "scan") {
        await fs.writeFile(
          schemaPath,
          JSON.stringify(SUGGESTIONS_JSON_SCHEMA),
          "utf-8",
        );
        args.push(
          "-s", "read-only",


          "--json",
          "-C", absRepoPath,
          "--output-schema", schemaPath,
          "-o", outputPath,
        );
      } else {
        args.push(
          "--full-auto",


          "--json",
          "-C", absRepoPath,
        );
      }

      if (!(await isGitRepo(absRepoPath))) {
        args.push("--skip-git-repo-check");
      }

      args.push(prompt);

      log("info", "Starting Codex agent", { repoPath: absRepoPath });

      const result = await execa(this.config.command, args, {
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

      // Fix mode: no structured output to parse
      if (mode === "fix") {
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

      // Primary: read from -o output file
      let parseResult;
      try {
        const outputContent = await fs.readFile(outputPath, "utf-8");
        if (outputContent.trim()) {
          parseResult = parseFromFile(outputContent);
        }
      } catch {
        // -o file may not exist if agent produced no output
      }

      // Fallback: parse JSONL from stdout
      if (!parseResult || (parseResult.suggestions.length === 0 && parseResult.errors.length > 0)) {
        const jsonlResult = parseFromJsonl(result.stdout);
        if (jsonlResult.suggestions.length > 0) {
          parseResult = jsonlResult;
        }
        parseResult = parseResult ?? jsonlResult;
      }

      if (parseResult.suggestions.length === 0 && parseResult.errors.length > 0) {
        return {
          agent: this.config.name,
          status: "parse-error",
          suggestions: [],
          rawOutput: result.stdout,
          rawError: result.stderr,
          durationMs,
          startedAt,
          error: parseResult.errors.join("; "),
        };
      }

      return {
        agent: this.config.name,
        status: "success",
        suggestions: parseResult.suggestions,
        rawOutput: result.stdout,
        rawError: result.stderr,
        durationMs,
        startedAt,
      };
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
    } finally {
      // Guaranteed cleanup per RELIABILITY.md
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        log("warn", "Failed to clean up temp directory", { tmpDir });
      }
    }
  }
}
