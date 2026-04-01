import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FixLogEntry, DiscardedFixEntry } from "../types.js";

const KAICHO_DIR = ".kaicho";
const FIX_LOG_FILE = "fixed.json";
const DISCARDED_LOG_FILE = "discarded.json";

/**
 * Read the fix log (read-only — no pruning, no git calls).
 */
export async function readFixLog(repoPath: string): Promise<FixLogEntry[]> {
  const filePath = path.join(repoPath, KAICHO_DIR, FIX_LOG_FILE);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content) as { entries: FixLogEntry[] };
    return data.entries;
  } catch {
    return [];
  }
}

/**
 * Read the discarded fixes log (read-only).
 */
export async function readDiscardedLog(repoPath: string): Promise<DiscardedFixEntry[]> {
  const filePath = path.join(repoPath, KAICHO_DIR, DISCARDED_LOG_FILE);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content) as { entries: DiscardedFixEntry[] };
    return data.entries;
  } catch {
    return [];
  }
}

/**
 * Get fixed cluster IDs as a Set for quick lookup.
 */
export async function getFixedClusterIds(repoPath: string): Promise<Set<string>> {
  const entries = await readFixLog(repoPath);
  return new Set(entries.map((e) => e.clusterId));
}
