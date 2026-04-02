import { SqliteStore } from "../suggestion-store/index.js";

export interface FixLogEntry {
  clusterId: string;
  file: string;
  agent: string;
  branch: string;
  fixedAt: string;
  /** Added in v0.2 — optional for backward compat with older fixed.json */
  line?: number | null;
  severity?: string;
  category?: string;
  rationale?: string;
  diff?: string;
}

/**
 * Load all recorded fixes from the SQLite store.
 */
export async function loadFixLog(repoPath: string): Promise<FixLogEntry[]> {
  const store = new SqliteStore(repoPath);
  try {
    return store.loadFixes();
  } finally {
    store.close();
  }
}

/**
 * Record that a cluster was fixed.
 * Deduplication is handled at the DB level (UNIQUE on clusterId+branch).
 */
export async function recordFix(
  repoPath: string,
  entry: FixLogEntry,
): Promise<void> {
  const store = new SqliteStore(repoPath);
  try {
    store.recordFix(entry);
  } finally {
    store.close();
  }
}

/**
 * Get the set of cluster IDs that have already been fixed.
 */
export async function getFixedClusterIds(repoPath: string): Promise<Set<string>> {
  const store = new SqliteStore(repoPath);
  try {
    return store.getFixedClusterIds();
  } finally {
    store.close();
  }
}
