import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { SqliteStore } from "./sqlite-store.js";
import type { RunResult } from "../types/index.js";
import type { FixLogEntry } from "../fix-log/fix-log.js";
import type { DiscardedFixEntry } from "../fix-log/discarded-log.js";
import type { SweepReport } from "../orchestrator/sweep-types.js";

let tmpDir: string;
let store: SqliteStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaicho-test-sqlite-"));
  store = new SqliteStore(tmpDir);
});

afterEach(async () => {
  store.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeRunResult(overrides?: Partial<RunResult>): RunResult {
  return {
    agent: "codex",
    status: "success",
    suggestions: [
      {
        file: "test.ts",
        line: 1,
        category: "security",
        severity: "high",
        rationale: "Test issue",
        suggestedChange: null,
      },
    ],
    rawOutput: "raw",
    rawError: "",
    durationMs: 1234,
    startedAt: "2026-03-26T12:00:00.000Z",
    ...overrides,
  };
}

describe("SqliteStore — runs", () => {
  it("creates .kaicho/kaicho.db file", async () => {
    const dbPath = path.join(tmpDir, ".kaicho", "kaicho.db");
    const stat = await fs.stat(dbPath);
    expect(stat.isFile()).toBe(true);
  });

  it("saves and reads a run record with suggestions", () => {
    const runId = store.save(makeRunResult(), "security", tmpDir);
    expect(runId).toBeDefined();

    const records = store.readRunRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.agent).toBe("codex");
    expect(records[0]!.task).toBe("security");
    expect(records[0]!.suggestionCount).toBe(1);
    expect(records[0]!.suggestions).toHaveLength(1);
    expect(records[0]!.suggestions[0]!.severity).toBe("high");
  });

  it("does not include rawOutput in the stored data", () => {
    store.save(makeRunResult({ rawOutput: "very large raw output" }), "security", tmpDir);
    const records = store.readRunRecords();
    const record = records[0]!;
    expect(record).not.toHaveProperty("rawOutput");
    expect(record).not.toHaveProperty("rawError");
  });

  it("includes error field when present", () => {
    store.save(
      makeRunResult({ status: "agent-error", error: "Auth failed", suggestions: [] }),
      "security",
      tmpDir,
    );
    const records = store.readRunRecords();
    expect(records[0]!.status).toBe("agent-error");
    expect(records[0]!.error).toBe("Auth failed");
    expect(records[0]!.suggestionCount).toBe(0);
  });

  it("filters by task and agent", () => {
    store.save(makeRunResult({ agent: "claude" }), "security", tmpDir);
    store.save(makeRunResult({ agent: "codex" }), "qa", tmpDir);
    store.save(makeRunResult({ agent: "gemini" }), "security", tmpDir);

    expect(store.readRunRecords({ task: "security" })).toHaveLength(2);
    expect(store.readRunRecords({ agent: "codex" })).toHaveLength(1);
    expect(store.readRunRecords({ task: "security", agent: "claude" })).toHaveLength(1);
  });

  it("returns distinct tasks", () => {
    store.save(makeRunResult(), "security", tmpDir);
    store.save(makeRunResult(), "qa", tmpDir);
    store.save(makeRunResult(), "security", tmpDir);

    const tasks = store.distinctTasks();
    expect(tasks).toEqual(["qa", "security"]);
  });
});

describe("SqliteStore — fixes", () => {
  const entry: FixLogEntry = {
    clusterId: "abc123",
    file: "src/app.ts",
    agent: "claude",
    branch: "kaicho/fix-abc123",
    fixedAt: "2026-03-26T12:00:00.000Z",
    line: 10,
    severity: "high",
    category: "security",
    rationale: "SQL injection risk",
    diff: "- old\n+ new",
  };

  it("records and loads fixes", () => {
    store.recordFix(entry);
    const fixes = store.loadFixes();
    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.clusterId).toBe("abc123");
    expect(fixes[0]!.diff).toBe("- old\n+ new");
  });

  it("deduplicates by clusterId+branch", () => {
    store.recordFix(entry);
    store.recordFix(entry);
    expect(store.loadFixes()).toHaveLength(1);
  });

  it("returns fixed cluster IDs", () => {
    store.recordFix(entry);
    store.recordFix({ ...entry, clusterId: "def456", branch: "kaicho/fix-def456" });
    const ids = store.getFixedClusterIds();
    expect(ids.size).toBe(2);
    expect(ids.has("abc123")).toBe(true);
    expect(ids.has("def456")).toBe(true);
  });
});

describe("SqliteStore — discarded fixes", () => {
  const entry: DiscardedFixEntry = {
    clusterId: "abc123",
    file: "src/app.ts",
    line: 10,
    category: "security",
    severity: "high",
    summary: "SQL injection",
    fixAgent: "claude",
    fixDiff: "- old\n+ new",
    fixerContext: null,
    reviewer: "gemini",
    verdict: "concern",
    reviewerRationale: "Not safe",
    retryAttempted: false,
    discardedAt: "2026-03-26T12:00:00.000Z",
    reason: "auto-concern",
  };

  it("records and loads discarded fixes", () => {
    store.recordDiscardedFix(entry);
    const discarded = store.loadDiscardedFixes();
    expect(discarded).toHaveLength(1);
    expect(discarded[0]!.reason).toBe("auto-concern");
    expect(discarded[0]!.retryAttempted).toBe(false);
  });
});

describe("SqliteStore — sweep reports", () => {
  const report: SweepReport = {
    startedAt: "2026-03-26T12:00:00.000Z",
    completedAt: "2026-03-26T13:00:00.000Z",
    repoPath: "/repo",
    sweepBranch: "kaicho/sweep-abc",
    totalRounds: 2,
    maxRounds: 3,
    exitReason: "zero-critical-high",
    strategy: "single-pass",
    rounds: [
      {
        round: 1,
        layers: [{ layer: 1, tasks: ["security"], findings: 5, fixed: 3, skipped: 0, failed: 0, keptBranches: [], regressions: [], manualActions: [], durationMs: 1000 }],
        totalFindings: 5,
        totalFixed: 3,
        totalRegressions: 0,
        criticalHighRemaining: 0,
        durationMs: 1000,
      },
    ],
    remaining: [],
    manualActions: [],
  };

  it("saves and loads sweep reports", () => {
    store.saveSweepReport(report);
    const reports = store.loadSweepReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.exitReason).toBe("zero-critical-high");
    expect(reports[0]!.rounds).toHaveLength(1);
    expect(reports[0]!.rounds[0]!.totalFindings).toBe(5);
  });
});

describe("SqliteStore — enrichments", () => {
  it("saves and loads enrichments", () => {
    store.saveEnrichment("abc", "src/app.ts", "Fix the SQL injection", "ollama", "security");
    store.saveEnrichment("def", "src/api.ts", "Add rate limiting", "ollama");

    const all = store.loadEnrichments();
    expect(all.size).toBe(2);
    expect(all.get("abc")).toBe("Fix the SQL injection");

    const byTask = store.loadEnrichments("security");
    expect(byTask.size).toBe(2); // includes task=NULL entries too
  });

  it("upserts on same clusterId+task", () => {
    store.saveEnrichment("abc", "src/app.ts", "Old summary", "ollama", "security");
    store.saveEnrichment("abc", "src/app.ts", "New summary", "ollama", "security");

    const all = store.loadEnrichments();
    expect(all.get("abc")).toBe("New summary");
  });
});
