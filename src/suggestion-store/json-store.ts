import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { RunResult } from "../types/index.js";
import { KAICHO_DIR, RUNS_DIR } from "../config/index.js";
import { log } from "../logger/index.js";

export interface RunRecord {
  runId: string;
  agent: string;
  task: string;
  repoPath: string;
  startedAt: string;
  durationMs: number;
  status: string;
  suggestions: RunResult["suggestions"];
  suggestionCount: number;
  error?: string;
}

export class JsonStore {
  private runsDir: string;
  private baseDir: string;

  constructor(repoPath: string) {
    this.baseDir = path.join(repoPath, KAICHO_DIR);
    this.runsDir = path.join(this.baseDir, RUNS_DIR);
  }

  async save(result: RunResult, task: string, repoPath: string): Promise<string> {
    await fs.mkdir(this.runsDir, { recursive: true });
    await this.rejectSymlinks(this.baseDir, this.runsDir);

    const record: RunRecord = {
      runId: randomUUID(),
      agent: result.agent,
      task,
      repoPath,
      startedAt: result.startedAt,
      durationMs: result.durationMs,
      status: result.status,
      suggestions: result.suggestions,
      suggestionCount: result.suggestions.length,
      error: result.error,
    };

    const safeTimestamp = result.startedAt.replace(/[:.]/g, "-");
    const filename = `${safeTimestamp}_${result.agent}_${task}.json`;
    const filePath = path.join(this.runsDir, filename);

    await this.safeWriteFile(filePath, JSON.stringify(record, null, 2), repoPath);

    const latestPath = path.join(this.baseDir, "latest.json");
    await this.safeWriteFile(latestPath, JSON.stringify(record, null, 2), repoPath);

    log("info", "Run saved", { path: filePath, suggestions: record.suggestionCount });

    return filePath;
  }

  /**
   * Reject symlinks in the write path to prevent a malicious repo from
   * redirecting writes outside the repo root.
   */
  private async rejectSymlinks(...paths: string[]): Promise<void> {
    for (const p of paths) {
      try {
        const stat = await fs.lstat(p);
        if (stat.isSymbolicLink()) {
          throw new Error(`Refusing to write through symlink: ${p}`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Refusing")) throw err;
        // Path doesn't exist yet — that's fine, mkdir will create it
      }
    }
  }

  /**
   * Write a file only after verifying the resolved path stays within the
   * repo root and the target is not a symlink.
   */
  private async safeWriteFile(
    filePath: string,
    content: string,
    repoPath: string,
  ): Promise<void> {
    const resolved = await fs.realpath(path.dirname(filePath))
      .then((dir) => path.join(dir, path.basename(filePath)))
      .catch(() => filePath);

    // Resolve repoPath too — on macOS /var is a symlink to /private/var
    const resolvedRepo = await fs.realpath(repoPath).catch(() => repoPath);

    if (!resolved.startsWith(resolvedRepo)) {
      throw new Error(
        `Path traversal detected: ${resolved} is outside repo root ${repoPath}`,
      );
    }

    // Check target file itself if it already exists
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to write through symlink: ${filePath}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Refusing")) throw err;
    }

    await fs.writeFile(filePath, content, "utf-8");
  }
}
