import type Database from "better-sqlite3";
import type { RunRecord, Suggestion } from "../types.js";

export interface RunFilter {
  task?: string;
  agent?: string;
}

/**
 * Read all run records from SQLite, newest first.
 * Optionally filter by task and/or agent.
 */
export function readRunRecords(db: Database.Database, filter?: RunFilter): RunRecord[] {
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

  const runs = db.prepare(runQuery).all(...params) as Array<{
    run_id: string; agent: string; task: string; repo_path: string;
    started_at: string; duration_ms: number; status: string;
    suggestion_count: number; error: string | null;
  }>;

  if (runs.length === 0) return [];

  const runIds = runs.map((r) => r.run_id);
  const placeholders = runIds.map(() => "?").join(",");
  const suggestions = db.prepare(
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

/**
 * Read a single run record by runId.
 */
export function readRunRecord(db: Database.Database, runId: string): RunRecord | null {
  const run = db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as {
    run_id: string; agent: string; task: string; repo_path: string;
    started_at: string; duration_ms: number; status: string;
    suggestion_count: number; error: string | null;
  } | undefined;

  if (!run) return null;

  const suggestions = db.prepare(
    "SELECT * FROM suggestions WHERE run_id = ?",
  ).all(run.run_id) as Array<{
    file: string; line: number | null; category: string;
    severity: string; rationale: string; suggested_change: string | null;
  }>;

  return {
    runId: run.run_id,
    agent: run.agent,
    task: run.task,
    repoPath: run.repo_path,
    startedAt: run.started_at,
    durationMs: run.duration_ms,
    status: run.status,
    suggestions: suggestions.map((s) => ({
      file: s.file,
      line: s.line,
      category: s.category as Suggestion["category"],
      severity: s.severity as Suggestion["severity"],
      rationale: s.rationale,
      suggestedChange: s.suggested_change,
    })),
    suggestionCount: run.suggestion_count,
    error: run.error ?? undefined,
  };
}
