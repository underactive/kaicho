import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { KAICHO_DIR } from "../config/index.js";
import { log } from "../logger/index.js";
import type { RunResult, Suggestion } from "../types/index.js";
import type { FixLogEntry } from "../fix-log/fix-log.js";
import type { DiscardedFixEntry } from "../fix-log/discarded-log.js";
import type { SweepReport, SweepRegressionReport } from "../orchestrator/sweep-types.js";

export interface RunRecord {
  runId: string;
  agent: string;
  task: string;
  repoPath: string;
  startedAt: string;
  durationMs: number;
  status: string;
  suggestions: Suggestion[];
  suggestionCount: number;
  error?: string;
}

const DB_FILE = "kaicho.db";

export class SqliteStore {
  private db: Database.Database;

  constructor(repoPath: string) {
    const dbDir = path.join(repoPath, KAICHO_DIR);
    rejectSymlink(dbDir);
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, DB_FILE);
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.init();
  }

  private init(): void {
    this.db.exec(SCHEMA);
  }

  // --- Runs ---

  save(result: RunResult, task: string, repoPath: string): string {
    const runId = randomUUID();
    const record: RunRecord = {
      runId,
      agent: result.agent,
      task,
      repoPath,
      startedAt: result.startedAt,
      durationMs: result.durationMs,
      status: result.status,
      suggestions: result.suggestions,
      suggestionCount: result.suggestions.length,
      error: result.error,
    };

    const insertRun = this.db.prepare(`
      INSERT INTO runs (run_id, agent, task, repo_path, started_at, duration_ms, status, suggestion_count, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSuggestion = this.db.prepare(`
      INSERT INTO suggestions (run_id, file, line, category, severity, rationale, suggested_change)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      insertRun.run(
        record.runId, record.agent, record.task, record.repoPath,
        record.startedAt, record.durationMs, record.status,
        record.suggestionCount, record.error ?? null,
      );
      for (const s of result.suggestions) {
        insertSuggestion.run(
          record.runId, s.file, s.line ?? null, s.category,
          s.severity, s.rationale, s.suggestedChange ?? null,
        );
      }
    });

    tx();
    log("info", "Run saved", { runId, suggestions: record.suggestionCount });
    return runId;
  }

  readRunRecords(filter?: { task?: string; agent?: string }): RunRecord[] {
    let runQuery = "SELECT * FROM runs";
    const conditions: string[] = [];
    const params: string[] = [];

    if (filter?.task) {
      conditions.push("task = ?");
      params.push(filter.task);
    }
    if (filter?.agent) {
      conditions.push("agent = ?");
      params.push(filter.agent);
    }
    if (conditions.length > 0) {
      runQuery += ` WHERE ${conditions.join(" AND ")}`;
    }
    runQuery += " ORDER BY started_at DESC";

    const runs = this.db.prepare(runQuery).all(...params) as Array<{
      run_id: string; agent: string; task: string; repo_path: string;
      started_at: string; duration_ms: number; status: string;
      suggestion_count: number; error: string | null;
    }>;

    if (runs.length === 0) return [];

    const runIds = runs.map((r) => r.run_id);
    const placeholders = runIds.map(() => "?").join(",");
    const suggestions = this.db.prepare(
      `SELECT * FROM suggestions WHERE run_id IN (${placeholders})`,
    ).all(...runIds) as Array<{
      run_id: string; file: string; line: number | null; category: string;
      severity: string; rationale: string; suggested_change: string | null;
    }>;

    const sugsByRun = new Map<string, Suggestion[]>();
    for (const s of suggestions) {
      const arr = sugsByRun.get(s.run_id) ?? [];
      arr.push({
        file: s.file,
        line: s.line,
        category: s.category as Suggestion["category"],
        severity: s.severity as Suggestion["severity"],
        rationale: s.rationale,
        suggestedChange: s.suggested_change,
      });
      sugsByRun.set(s.run_id, arr);
    }

    return runs.map((r) => ({
      runId: r.run_id,
      agent: r.agent,
      task: r.task,
      repoPath: r.repo_path,
      startedAt: r.started_at,
      durationMs: r.duration_ms,
      status: r.status,
      suggestions: sugsByRun.get(r.run_id) ?? [],
      suggestionCount: r.suggestion_count,
      error: r.error ?? undefined,
    }));
  }

  // --- Fixes ---

  recordFix(entry: FixLogEntry): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO fixes (cluster_id, file, agent, branch, fixed_at, line, severity, category, rationale, diff)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.clusterId, entry.file, entry.agent, entry.branch, entry.fixedAt,
      entry.line ?? null, entry.severity ?? null, entry.category ?? null,
      entry.rationale ?? null, entry.diff ?? null,
    );
  }

  loadFixes(): FixLogEntry[] {
    const rows = this.db.prepare("SELECT * FROM fixes ORDER BY fixed_at DESC").all() as Array<{
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

  getFixedClusterIds(): Set<string> {
    const rows = this.db.prepare("SELECT DISTINCT cluster_id FROM fixes").all() as Array<{ cluster_id: string }>;
    return new Set(rows.map((r) => r.cluster_id));
  }

  // --- Discarded fixes ---

  recordDiscardedFix(entry: DiscardedFixEntry): void {
    this.db.prepare(`
      INSERT INTO discarded_fixes (
        cluster_id, file, line, category, severity, summary,
        fix_agent, fix_diff, fixer_context, reviewer, verdict,
        reviewer_rationale, retry_attempted, discarded_at, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.clusterId, entry.file, entry.line ?? null, entry.category,
      entry.severity, entry.summary ?? null, entry.fixAgent, entry.fixDiff,
      entry.fixerContext ?? null, entry.reviewer ?? null, entry.verdict ?? null,
      entry.reviewerRationale ?? null, entry.retryAttempted ? 1 : 0,
      entry.discardedAt, entry.reason,
    );
  }

  loadDiscardedFixes(): DiscardedFixEntry[] {
    const rows = this.db.prepare("SELECT * FROM discarded_fixes ORDER BY discarded_at DESC").all() as Array<{
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

  // --- Sweep reports ---

  saveSweepReport(report: SweepReport): void {
    const reportJson = JSON.stringify({
      rounds: report.rounds,
      remaining: report.remaining,
      manualActions: (report as SweepReport & { manualActions?: unknown }).manualActions ?? [],
    });

    this.db.prepare(`
      INSERT INTO sweep_reports (started_at, completed_at, repo_path, sweep_branch, total_rounds, max_rounds, exit_reason, strategy, report_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.startedAt, report.completedAt, report.repoPath, report.sweepBranch,
      report.totalRounds, report.maxRounds, report.exitReason,
      report.strategy ?? null, reportJson,
    );
    log("info", "Sweep report saved", { startedAt: report.startedAt });
  }

  saveSweepRegressions(regressions: SweepRegressionReport): void {
    // Store regressions as a lightweight JSON row — read as-is
    this.db.prepare(`
      INSERT INTO sweep_reports (started_at, completed_at, repo_path, sweep_branch, total_rounds, max_rounds, exit_reason, strategy, report_json, regressions_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(), new Date().toISOString(), "", regressions.sweepBranch,
      0, 0, "regressions", null, "{}", JSON.stringify(regressions),
    );
  }

  loadSweepReports(): SweepReport[] {
    const rows = this.db.prepare(
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
        manualActions?: SweepReport["manualActions"];
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
        manualActions: parsed.manualActions ?? [],
      };
    });
  }

  // --- Enrichments ---

  saveEnrichment(
    clusterId: string,
    file: string,
    summary: string,
    model: string,
    task?: string,
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO enrichments (cluster_id, task, file, summary, model, generated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(clusterId, task ?? null, file, summary, model, new Date().toISOString());
  }

  loadEnrichments(task?: string): Map<string, string> {
    let query = "SELECT cluster_id, summary FROM enrichments";
    const params: string[] = [];
    if (task) {
      query += " WHERE task = ? OR task IS NULL";
      params.push(task);
    }
    const rows = this.db.prepare(query).all(...params) as Array<{
      cluster_id: string; summary: string;
    }>;
    const map = new Map<string, string>();
    for (const r of rows) {
      if (!map.has(r.cluster_id)) {
        map.set(r.cluster_id, r.summary);
      }
    }
    return map;
  }

  // --- Query helpers ---

  distinctTasks(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT task FROM runs ORDER BY task").all() as Array<{ task: string }>;
    return rows.map((r) => r.task);
  }

  // --- Lifecycle ---

  close(): void {
    this.db.close();
  }
}

// --- Security ---

function rejectSymlink(dirPath: string): void {
  try {
    const stat = fs.lstatSync(dirPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to open database through symlink: ${dirPath}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Refusing")) throw err;
    // Directory doesn't exist yet — mkdirSync will create it
  }
}

// --- Schema DDL ---

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id            TEXT PRIMARY KEY,
  agent             TEXT NOT NULL,
  task              TEXT NOT NULL,
  repo_path         TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  duration_ms       INTEGER NOT NULL,
  status            TEXT NOT NULL,
  suggestion_count  INTEGER NOT NULL DEFAULT 0,
  error             TEXT
);

CREATE TABLE IF NOT EXISTS suggestions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  file              TEXT NOT NULL,
  line              INTEGER,
  category          TEXT NOT NULL,
  severity          TEXT NOT NULL,
  rationale         TEXT NOT NULL,
  suggested_change  TEXT
);

CREATE TABLE IF NOT EXISTS fixes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id  TEXT NOT NULL,
  file        TEXT NOT NULL,
  agent       TEXT NOT NULL,
  branch      TEXT NOT NULL,
  fixed_at    TEXT NOT NULL,
  line        INTEGER,
  severity    TEXT,
  category    TEXT,
  rationale   TEXT,
  diff        TEXT,
  UNIQUE(cluster_id, branch)
);

CREATE TABLE IF NOT EXISTS discarded_fixes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id          TEXT NOT NULL,
  file                TEXT NOT NULL,
  line                INTEGER,
  category            TEXT NOT NULL,
  severity            TEXT NOT NULL,
  summary             TEXT,
  fix_agent           TEXT NOT NULL,
  fix_diff            TEXT NOT NULL,
  fixer_context       TEXT,
  reviewer            TEXT,
  verdict             TEXT,
  reviewer_rationale  TEXT,
  retry_attempted     INTEGER NOT NULL DEFAULT 0,
  discarded_at        TEXT NOT NULL,
  reason              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sweep_reports (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT NOT NULL,
  completed_at      TEXT NOT NULL,
  repo_path         TEXT NOT NULL,
  sweep_branch      TEXT NOT NULL,
  total_rounds      INTEGER NOT NULL,
  max_rounds        INTEGER NOT NULL,
  exit_reason       TEXT NOT NULL,
  strategy          TEXT,
  report_json       TEXT NOT NULL,
  regressions_json  TEXT
);

CREATE TABLE IF NOT EXISTS enrichments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id    TEXT NOT NULL,
  task          TEXT,
  file          TEXT NOT NULL,
  summary       TEXT NOT NULL,
  model         TEXT NOT NULL,
  generated_at  TEXT NOT NULL,
  UNIQUE(cluster_id, task)
);

CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
CREATE INDEX IF NOT EXISTS idx_suggestions_run_id ON suggestions(run_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_severity ON suggestions(severity);
CREATE INDEX IF NOT EXISTS idx_fixes_cluster_id ON fixes(cluster_id);
CREATE INDEX IF NOT EXISTS idx_discarded_cluster_id ON discarded_fixes(cluster_id);
CREATE INDEX IF NOT EXISTS idx_sweep_started_at ON sweep_reports(started_at);
CREATE INDEX IF NOT EXISTS idx_enrichments_cluster_id ON enrichments(cluster_id);
`;
