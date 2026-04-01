import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RunRecord } from "../types.js";

const KAICHO_DIR = ".kaicho";
const RUNS_DIR = "runs";

export interface RunFilter {
  task?: string;
  agent?: string;
}

/**
 * Read all run records from .kaicho/runs/, newest first.
 * Optionally filter by task and/or agent.
 */
export async function readRunRecords(repoPath: string, filter?: RunFilter): Promise<RunRecord[]> {
  const runsDir = path.join(repoPath, KAICHO_DIR, RUNS_DIR);

  let files: string[];
  try {
    files = (await fs.readdir(runsDir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse(); // newest first
  } catch {
    return [];
  }

  const records: RunRecord[] = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(runsDir, file), "utf-8");
      const record = JSON.parse(content) as RunRecord;

      if (filter?.task && record.task !== filter.task) continue;
      if (filter?.agent && record.agent !== filter.agent) continue;

      records.push(record);
    } catch {
      // Skip unparseable files
    }
  }

  return records;
}

/**
 * Read a single run record by filename.
 */
export async function readRunRecord(repoPath: string, filename: string): Promise<RunRecord | null> {
  const sanitized = path.basename(filename);
  const filePath = path.join(repoPath, KAICHO_DIR, RUNS_DIR, sanitized);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as RunRecord;
  } catch {
    return null;
  }
}
