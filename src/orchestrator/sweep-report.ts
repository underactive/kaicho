import { SqliteStore } from "../suggestion-store/index.js";
import { log } from "../logger/index.js";
import type { SweepReport, SweepRegressionReport } from "./sweep-types.js";

/**
 * Write the full sweep report to the SQLite store.
 * Returns a description string for logging.
 */
export async function writeSweepReport(
  repoPath: string,
  report: SweepReport,
): Promise<string> {
  const store = new SqliteStore(repoPath);
  try {
    store.saveSweepReport(report);
    log("info", "Sweep report written", { startedAt: report.startedAt });
    return `sqlite:sweep_reports(${report.startedAt})`;
  } finally {
    store.close();
  }
}

/**
 * Write the regressions report to the SQLite store.
 * Only called if regressions were detected. Returns a description string.
 */
export async function writeSweepRegressions(
  repoPath: string,
  regressions: SweepRegressionReport,
): Promise<string> {
  const store = new SqliteStore(repoPath);
  try {
    store.saveSweepRegressions(regressions);
    log("info", "Sweep regressions report written", { branch: regressions.sweepBranch });
    return `sqlite:sweep_reports(regressions)`;
  } finally {
    store.close();
  }
}
