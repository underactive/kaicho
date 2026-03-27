import * as fs from "node:fs/promises";
import * as path from "node:path";
import { KAICHO_DIR } from "../config/index.js";
import { log } from "../logger/index.js";

const DISCARDED_LOG_FILE = "discarded.json";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface DiscardedFixEntry {
  clusterId: string;
  file: string;
  line: number | null;
  category: string;
  severity: string;
  summary: string | null;
  fixAgent: string;
  fixDiff: string;
  fixerContext: string | null;
  reviewer: string | null;
  verdict: string | null;
  reviewerRationale: string | null;
  retryAttempted: boolean;
  discardedAt: string;
  reason: "user-discard" | "auto-concern" | "retry-failed";
}

interface DiscardedLogData {
  entries: DiscardedFixEntry[];
}

function discardedLogPath(repoPath: string): string {
  return path.join(repoPath, KAICHO_DIR, DISCARDED_LOG_FILE);
}

/**
 * Record a discarded fix with full context for future human or agent review.
 */
export async function recordDiscardedFix(
  repoPath: string,
  entry: DiscardedFixEntry,
): Promise<void> {
  const entries = await loadDiscardedLog(repoPath);
  entries.push(entry);
  await saveDiscardedLog(repoPath, entries);
  log("info", "Recorded discarded fix", { clusterId: entry.clusterId, reason: entry.reason });
}

/**
 * Load discarded fixes, pruning entries older than 30 days.
 */
export async function loadDiscardedLog(repoPath: string): Promise<DiscardedFixEntry[]> {
  const filePath = discardedLogPath(repoPath);

  let data: DiscardedLogData;
  try {
    const content = await fs.readFile(filePath, "utf-8");
    data = JSON.parse(content) as DiscardedLogData;
  } catch {
    return [];
  }

  const now = Date.now();
  const entries = data.entries.filter((e) => {
    const age = now - new Date(e.discardedAt).getTime();
    return age < MAX_AGE_MS;
  });

  if (entries.length < data.entries.length) {
    log("info", "Pruned discarded log", {
      removed: data.entries.length - entries.length,
      remaining: entries.length,
    });
    await saveDiscardedLog(repoPath, entries);
  }

  return entries;
}

async function saveDiscardedLog(
  repoPath: string,
  entries: DiscardedFixEntry[],
): Promise<void> {
  const filePath = discardedLogPath(repoPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify({ entries }, null, 2),
    "utf-8",
  );
}
