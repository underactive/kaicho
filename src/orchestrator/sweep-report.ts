import * as fs from "node:fs/promises";
import * as path from "node:path";
import { KAICHO_DIR } from "../config/index.js";
import { log } from "../logger/index.js";
import type { SweepReport, SweepRegressionReport } from "./sweep-types.js";

const SWEEP_REPORT_FILE = "sweep-report.json";
const SWEEP_REGRESSIONS_FILE = "sweep-regressions.json";

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Write the full sweep report to .kaicho/sweep-report.json.
 * Returns the file path.
 */
export async function writeSweepReport(
  repoPath: string,
  report: SweepReport,
): Promise<string> {
  const dir = path.join(repoPath, KAICHO_DIR);
  await ensureDir(dir);
  const filePath = path.join(dir, SWEEP_REPORT_FILE);
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf-8");
  log("info", "Sweep report written", { path: filePath });
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
