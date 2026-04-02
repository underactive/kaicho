import type Database from "better-sqlite3";
import type { FixLogEntry, DiscardedFixEntry } from "../types.js";

/**
 * Read all fix log entries from SQLite.
 */
export function readFixLog(db: Database.Database): FixLogEntry[] {
  const rows = db.prepare("SELECT * FROM fixes ORDER BY fixed_at DESC").all() as Array<{
    cluster_id: string; file: string; agent: string; branch: string; fixed_at: string;
    line: number | null; severity: string | null; category: string | null;
    rationale: string | null; diff: string | null;
  }>;
  return rows.map((r) => ({
    clusterId: r.cluster_id,
    file: r.file,
    agent: r.agent,
    branch: r.branch,
    fixedAt: r.fixed_at,
    line: r.line,
    severity: r.severity ?? undefined,
    category: r.category ?? undefined,
    rationale: r.rationale ?? undefined,
    diff: r.diff ?? undefined,
  }));
}

/**
 * Read all discarded fix entries from SQLite.
 */
export function readDiscardedLog(db: Database.Database): DiscardedFixEntry[] {
  const rows = db.prepare("SELECT * FROM discarded_fixes ORDER BY discarded_at DESC").all() as Array<{
    cluster_id: string; file: string; line: number | null; category: string;
    severity: string; summary: string | null; fix_agent: string; fix_diff: string;
    fixer_context: string | null; reviewer: string | null; verdict: string | null;
    reviewer_rationale: string | null; retry_attempted: number; discarded_at: string;
    reason: string;
  }>;
  return rows.map((r) => ({
    clusterId: r.cluster_id,
    file: r.file,
    line: r.line,
    category: r.category,
    severity: r.severity,
    summary: r.summary,
    fixAgent: r.fix_agent,
    fixDiff: r.fix_diff,
    fixerContext: r.fixer_context,
    reviewer: r.reviewer,
    verdict: r.verdict,
    reviewerRationale: r.reviewer_rationale,
    retryAttempted: r.retry_attempted === 1,
    discardedAt: r.discarded_at,
    reason: r.reason as DiscardedFixEntry["reason"],
  }));
}

/**
 * Get fixed cluster IDs as a Set for quick lookup.
 */
export function getFixedClusterIds(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT DISTINCT cluster_id FROM fixes").all() as Array<{ cluster_id: string }>;
  return new Set(rows.map((r) => r.cluster_id));
}
