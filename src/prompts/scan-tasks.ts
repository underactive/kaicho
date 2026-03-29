/**
 * Single source of truth for scan task names.
 * Imported by the orchestrator, CLI, tests, and docs tooling.
 */
export const SCAN_TASKS = [
  "security",
  "qa",
  "docs",
  "contracts",
  "state",
  "resources",
  "testing",
  "dx",
  "performance",
  "resilience",
  "logging",
] as const;

export type ScanTask = (typeof SCAN_TASKS)[number];
