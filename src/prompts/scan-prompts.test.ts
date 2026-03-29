import { describe, it, expect } from "vitest";
import { SCAN_TASKS, type ScanTask } from "./scan-tasks.js";
import { buildSecurityScanPrompt } from "./security-scan.js";
import { buildQaScanPrompt } from "./qa-scan.js";
import { buildDocsScanPrompt } from "./docs-scan.js";
import { buildContractsScanPrompt } from "./contracts-scan.js";
import { buildStateScanPrompt } from "./state-scan.js";
import { buildResourcesScanPrompt } from "./resources-scan.js";
import { buildTestingScanPrompt } from "./testing-scan.js";
import { buildDxScanPrompt } from "./dx-scan.js";
import { buildPerformanceScanPrompt } from "./performance-scan.js";
import { buildResilienceScanPrompt } from "./resilience-scan.js";
import { buildLoggingScanPrompt } from "./logging-scan.js";
import { OUTPUT_INSTRUCTION } from "./shared.js";

type PromptBuilder = (fileManifest?: string, repoContext?: string) => string;

interface TaskTest {
  task: ScanTask;
  builder: PromptBuilder;
  /** Unique string that only this prompt should contain — guards against copy-paste */
  anchor: string;
}

const TASK_TESTS: TaskTest[] = [
  { task: "security", builder: buildSecurityScanPrompt, anchor: "Injection & input trust" },
  { task: "qa", builder: buildQaScanPrompt, anchor: "Functional correctness & logic errors" },
  { task: "docs", builder: buildDocsScanPrompt, anchor: "Exported API documentation" },
  { task: "contracts", builder: buildContractsScanPrompt, anchor: "Data shape mismatches" },
  { task: "state", builder: buildStateScanPrompt, anchor: "Mutation discipline" },
  { task: "resources", builder: buildResourcesScanPrompt, anchor: "Concurrency" },
  { task: "testing", builder: buildTestingScanPrompt, anchor: "Missing tests" },
  { task: "dx", builder: buildDxScanPrompt, anchor: "Readability" },
  { task: "performance", builder: buildPerformanceScanPrompt, anchor: "N+1 queries" },
  { task: "resilience", builder: buildResilienceScanPrompt, anchor: "circuit breaker" },
  { task: "logging", builder: buildLoggingScanPrompt, anchor: "structured logging" },
];

// Ensure the test table covers every registered task
describe("scan-tasks registry coverage", () => {
  it("test table covers every task in SCAN_TASKS", () => {
    const tested = new Set(TASK_TESTS.map((t) => t.task));
    for (const task of SCAN_TASKS) {
      expect(tested.has(task), `missing test entry for task "${task}"`).toBe(true);
    }
  });

  it("SCAN_TASKS has exactly 11 entries", () => {
    expect(SCAN_TASKS).toHaveLength(11);
  });
});

for (const { task, builder, anchor } of TASK_TESTS) {
  describe(`${task} scan prompt`, () => {
    it("contains OUTPUT_INSTRUCTION", () => {
      const prompt = builder();
      expect(prompt).toContain(OUTPUT_INSTRUCTION.trim().slice(0, 40));
    });

    it(`contains unique anchor: "${anchor}"`, () => {
      const prompt = builder();
      expect(prompt.toLowerCase()).toContain(anchor.toLowerCase());
    });

    it("injects repo context when provided", () => {
      const ctx = "PROJECT CONTEXT (best-effort repo-level hints — may be incomplete or outdated):\n- Languages: TypeScript";
      const prompt = builder(undefined, ctx);
      expect(prompt).toContain("PROJECT CONTEXT");
      expect(prompt).toContain("TypeScript");
    });

    it("omits repo context when not provided", () => {
      const prompt = builder();
      expect(prompt).not.toContain("PROJECT CONTEXT");
    });

    it("injects file manifest via buildPromptPrelude", () => {
      const manifest = "Files to review (3 total):\nsrc/a.ts\nsrc/b.ts\nsrc/c.ts";
      const prompt = builder(manifest);
      expect(prompt).toContain("SCOPE: Only review the following files");
      expect(prompt).toContain("src/a.ts");
    });

    it("omits scope block when no file manifest", () => {
      const prompt = builder();
      expect(prompt).not.toContain("SCOPE:");
    });
  });
}
