import * as fs from "node:fs/promises";
import * as path from "node:path";
import { KAICHO_DIR, SWEEP_REPORTS_DIR, DEFAULT_SWEEP_REPORT_RETENTION } from "../config/index.js";
import { log } from "../logger/index.js";
import type { SweepReport, SweepRegressionReport } from "./sweep-types.js";

const SWEEP_REPORT_FILE = "sweep-report.json";
const SWEEP_REGRESSIONS_FILE = "sweep-regressions.json";

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Write the full sweep report to .kaicho/sweep-report.json (backward compat)
 * and a timestamped copy to .kaicho/sweep-reports/<timestamp>.json.
 * Returns the file path of the legacy report.
 */
export async function writeSweepReport(
  repoPath: string,
  report: SweepReport,
): Promise<string> {
  const dir = path.join(repoPath, KAICHO_DIR);
  await ensureDir(dir);

  const content = JSON.stringify(report, null, 2);

  // Legacy location (overwritten each sweep)
  const filePath = path.join(dir, SWEEP_REPORT_FILE);
  await fs.writeFile(filePath, content, "utf-8");

  // Timestamped copy for history
  const reportsDir = path.join(dir, SWEEP_REPORTS_DIR);
  await ensureDir(reportsDir);
  const safeTimestamp = report.startedAt.replace(/[:.]/g, "-");
  const timestampedPath = path.join(reportsDir, `${safeTimestamp}.json`);
  await fs.writeFile(timestampedPath, content, "utf-8");

  log("info", "Sweep report written", { path: filePath, history: timestampedPath });

  // Prune old reports
  await pruneSweepReports(reportsDir, DEFAULT_SWEEP_REPORT_RETENTION);

  return filePath;
}

/**
 * Write the regressions report to .kaicho/sweep-regressions.json.
 * Only written if regressions were detected. Returns the file path.
 */
export async function writeSweepRegressions(
  repoPath: string,
  regressions: SweepRegressionReport,
): Promise<string> {
  const dir = path.join(repoPath, KAICHO_DIR);
  await ensureDir(dir);
  const filePath = path.join(dir, SWEEP_REGRESSIONS_FILE);
  await fs.writeFile(filePath, JSON.stringify(regressions, null, 2), "utf-8");
  log("info", "Sweep regressions report written", { path: filePath });
  return filePath;
}

/**
 * Keep only the latest N sweep reports, removing oldest first.
 * Filenames are timestamp-based, so alphabetical sort = chronological.
 */
async function pruneSweepReports(reportsDir: string, retention: number): Promise<number> {
  let files: string[];
  try {
    files = (await fs.readdir(reportsDir))
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return 0;
  }

  if (files.length <= retention) return 0;

  const toRemove = files.slice(0, files.length - retention);
  let removed = 0;

  for (const file of toRemove) {
    try {
      await fs.unlink(path.join(reportsDir, file));
      removed++;
    } catch {
      // Best effort
    }
  }

  if (removed > 0) {
    log("info", "Pruned old sweep reports", { removed, retention });
  }

  return removed;
}
