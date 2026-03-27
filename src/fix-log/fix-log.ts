import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { KAICHO_DIR } from "../config/index.js";
import { log } from "../logger/index.js";

const FIX_LOG_FILE = "fixed.json";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface FixLogEntry {
  clusterId: string;
  file: string;
  agent: string;
  branch: string;
  fixedAt: string;
}

interface FixLogData {
  entries: FixLogEntry[];
}

function fixLogPath(repoPath: string): string {
  return path.join(repoPath, KAICHO_DIR, FIX_LOG_FILE);
}

/**
 * Load the fix log, pruning stale entries (deleted branches, old entries).
 */
export async function loadFixLog(repoPath: string): Promise<FixLogEntry[]> {
  const filePath = fixLogPath(repoPath);

  let data: FixLogData;
  try {
    const content = await fs.readFile(filePath, "utf-8");
    data = JSON.parse(content) as FixLogData;
  } catch {
    return [];
  }

  // Prune: remove entries older than 30 days
  const now = Date.now();
  let entries = data.entries.filter((e) => {
    const age = now - new Date(e.fixedAt).getTime();
    return age < MAX_AGE_MS;
  });

  // Prune: remove entries whose branch no longer exists
  const existingBranches = await listBranches(repoPath);
  const beforePrune = entries.length;
  entries = entries.filter((e) => existingBranches.has(e.branch));

  if (entries.length < beforePrune) {
    log("info", "Pruned fix log", {
      removed: beforePrune - entries.length,
      remaining: entries.length,
    });
    // Save pruned version
    await saveFixLogEntries(repoPath, entries);
  }

  return entries;
}

/**
 * Record that a cluster was fixed.
 */
export async function recordFix(
  repoPath: string,
  entry: FixLogEntry,
): Promise<void> {
  const entries = await loadFixLog(repoPath);

  // Don't duplicate
  if (entries.some((e) => e.clusterId === entry.clusterId && e.branch === entry.branch)) {
    return;
  }

  entries.push(entry);
  await saveFixLogEntries(repoPath, entries);
}

/**
 * Get the set of cluster IDs that have already been fixed.
 */
export async function getFixedClusterIds(repoPath: string): Promise<Set<string>> {
  const entries = await loadFixLog(repoPath);
  return new Set(entries.map((e) => e.clusterId));
}

async function saveFixLogEntries(
  repoPath: string,
  entries: FixLogEntry[],
): Promise<void> {
  const filePath = fixLogPath(repoPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify({ entries }, null, 2),
    "utf-8",
  );
}

async function listBranches(repoPath: string): Promise<Set<string>> {
  try {
    const result = await execa("git", ["branch", "--format=%(refname:short)"], {
      cwd: repoPath,
      reject: false,
    });
    if (result.exitCode !== 0) return new Set();
    return new Set(result.stdout.trim().split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}
