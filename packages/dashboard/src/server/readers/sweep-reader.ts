import type Database from "better-sqlite3";
import type { SweepReport } from "../types.js";

/**
 * Read all sweep reports from SQLite, sorted newest first.
 */
export function readSweepReports(db: Database.Database): SweepReport[] {
  const rows = db.prepare(
    "SELECT * FROM sweep_reports WHERE exit_reason != 'regressions' ORDER BY started_at DESC",
  ).all() as Array<{
    started_at: string; completed_at: string; repo_path: string; sweep_branch: string;
    total_rounds: number; max_rounds: number; exit_reason: string; strategy: string | null;
    report_json: string;
  }>;

  return rows.map((r) => {
    const parsed = JSON.parse(r.report_json) as {
      rounds: SweepReport["rounds"];
      remaining: SweepReport["remaining"];
    };
    return {
      startedAt: r.started_at,
      completedAt: r.completed_at,
      repoPath: r.repo_path,
      sweepBranch: r.sweep_branch,
      totalRounds: r.total_rounds,
      maxRounds: r.max_rounds,
      exitReason: r.exit_reason as SweepReport["exitReason"],
      strategy: r.strategy as SweepReport["strategy"],
      rounds: parsed.rounds,
      remaining: parsed.remaining,
    };
  });
}

/**
 * Read a single sweep report by index (0 = latest).
 */
export function readSweepReport(db: Database.Database, index: number): SweepReport | null {
  const reports = readSweepReports(db);
  return reports[index] ?? null;
}
