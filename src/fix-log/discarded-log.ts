import { SqliteStore } from "../suggestion-store/index.js";
import { log } from "../logger/index.js";

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

/**
 * Record a discarded fix with full context for future human or agent review.
 */
export async function recordDiscardedFix(
  repoPath: string,
  entry: DiscardedFixEntry,
): Promise<void> {
  const store = new SqliteStore(repoPath);
  try {
    store.recordDiscardedFix(entry);
    log("info", "Recorded discarded fix", { clusterId: entry.clusterId, reason: entry.reason });
  } finally {
    store.close();
  }
}

/**
 * Load all discarded fixes from the SQLite store.
 */
export async function loadDiscardedLog(repoPath: string): Promise<DiscardedFixEntry[]> {
  const store = new SqliteStore(repoPath);
  try {
    return store.loadDiscardedFixes();
  } finally {
    store.close();
  }
}
