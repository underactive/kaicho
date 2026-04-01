import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SweepReport } from "../types.js";

const KAICHO_DIR = ".kaicho";
const SWEEP_REPORTS_DIR = "sweep-reports";
const LEGACY_REPORT = "sweep-report.json";

/**
 * Read all sweep reports from .kaicho/sweep-reports/, sorted newest first.
 * Falls back to the legacy .kaicho/sweep-report.json if no history dir exists.
 */
export async function readSweepReports(repoPath: string): Promise<SweepReport[]> {
  const reportsDir = path.join(repoPath, KAICHO_DIR, SWEEP_REPORTS_DIR);

  try {
    const files = (await fs.readdir(reportsDir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse(); // newest first

    const reports: SweepReport[] = [];
    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(reportsDir, file), "utf-8");
        reports.push(JSON.parse(content) as SweepReport);
      } catch {
        // Skip unparseable files
      }
    }

    if (reports.length > 0) return reports;
  } catch {
    // No sweep-reports dir — fall through to legacy
  }

  // Fallback: read the legacy single report file
  return readLegacySweepReport(repoPath);
}

/**
 * Read a single sweep report by filename from .kaicho/sweep-reports/.
 */
export async function readSweepReport(repoPath: string, filename: string): Promise<SweepReport | null> {
  // Prevent path traversal
  const sanitized = path.basename(filename);
  const filePath = path.join(repoPath, KAICHO_DIR, SWEEP_REPORTS_DIR, sanitized);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as SweepReport;
  } catch {
    return null;
  }
}

async function readLegacySweepReport(repoPath: string): Promise<SweepReport[]> {
  const filePath = path.join(repoPath, KAICHO_DIR, LEGACY_REPORT);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return [JSON.parse(content) as SweepReport];
  } catch {
    return [];
  }
}
