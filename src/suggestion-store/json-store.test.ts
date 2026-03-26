import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { JsonStore } from "./json-store.js";
import type { RunResult } from "../types/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaicho-test-store-"));
});

afterEach(async () => {
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

describe("JsonStore", () => {
  it("creates .kaicho/runs/ directory", async () => {
    const store = new JsonStore(tmpDir);
    await store.save(makeRunResult(), "security", tmpDir);

    const runsDir = path.join(tmpDir, ".kaicho", "runs");
    const stat = await fs.stat(runsDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("writes valid JSON to runs file", async () => {
    const store = new JsonStore(tmpDir);
    const filePath = await store.save(makeRunResult(), "security", tmpDir);

    const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
    expect(content.agent).toBe("codex");
    expect(content.task).toBe("security");
    expect(content.suggestionCount).toBe(1);
    expect(content.suggestions).toHaveLength(1);
    expect(content.runId).toBeDefined();
  });

  it("writes latest.json", async () => {
    const store = new JsonStore(tmpDir);
    await store.save(makeRunResult(), "security", tmpDir);

    const latestPath = path.join(tmpDir, ".kaicho", "latest.json");
    const content = JSON.parse(await fs.readFile(latestPath, "utf-8"));
    expect(content.agent).toBe("codex");
  });

  it("does not include rawOutput in persisted record", async () => {
    const store = new JsonStore(tmpDir);
    const filePath = await store.save(
      makeRunResult({ rawOutput: "very large raw output" }),
      "security",
      tmpDir,
    );

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).not.toContain("rawOutput");
    expect(content).not.toContain("rawError");
  });

  it("includes error field when present", async () => {
    const store = new JsonStore(tmpDir);
    const filePath = await store.save(
      makeRunResult({ status: "agent-error", error: "Auth failed", suggestions: [] }),
      "security",
      tmpDir,
    );

    const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
    expect(content.status).toBe("agent-error");
    expect(content.error).toBe("Auth failed");
    expect(content.suggestionCount).toBe(0);
  });
});
