import type { ScanTask } from "../prompts/index.js";
import type { SuggestionCluster } from "../dedup/index.js";
import type { ParallelFixOptions, ParallelFixProgress } from "./run-parallel-fix.js";

// --- Layer definition ---

export interface SweepLayer {
  layer: number;
  tasks: ScanTask[];
}

export const SWEEP_LAYERS: SweepLayer[] = [
  { layer: 1, tasks: ["security"] },
  { layer: 2, tasks: ["qa"] },
  { layer: 3, tasks: ["contracts", "state"] },
  { layer: 4, tasks: ["resources", "resilience"] },
  { layer: 5, tasks: ["performance"] },
  { layer: 6, tasks: ["logging"] },
  { layer: 7, tasks: ["testing", "docs", "dx"] },
];

export const DEFAULT_MAX_ROUNDS = 3;

// --- Options ---

export interface SweepOptions {
  repoPath: string;
  maxRounds?: number;
  auto?: boolean;
  agents?: string[];
  exclude?: string[];
  timeoutMs?: number;
  models?: Record<string, string>;
  scanModels?: Record<string, string>;
  concurrency?: number;
  validate?: boolean;
  reviewers?: string[];
  verbose?: boolean;
  /** Run a full re-scan after all rounds to populate the remaining-findings report. Off by default. */
  finalScan?: boolean;
  /** Two-pass strategy: Pass 1 cleans all layers low-to-high without regression checks; Pass 2 runs security+qa with full checks. */
  twoPass?: boolean;
  onScanProgress?: (progress: import("./run-scan.js").ScanProgress) => void;
  onLayerStart?: (round: number, layer: SweepLayer) => void;
  onLayerComplete?: (round: number, result: SweepLayerResult) => void;
  onRoundComplete?: (result: SweepRoundResult) => void;
  onFixProgress?: (progress: ParallelFixProgress) => void;
  onConfirm?: ParallelFixOptions["onConfirm"];
}

// --- Results ---

export interface SweepLayerResult {
  layer: number;
  tasks: string[];
  findings: number;
  fixed: number;
  skipped: number;
  failed: number;
  keptBranches: string[];
  regressions: SweepRegression[];
  manualActions: ManualAction[];
  durationMs: number;
}

export interface SweepRoundResult {
  round: number;
  pass?: 1 | 2;
  layers: SweepLayerResult[];
  totalFindings: number;
  totalFixed: number;
  totalRegressions: number;
  criticalHighRemaining: number;
  durationMs: number;
}

export interface SweepRegression {
  previousLayerTasks: string[];
  newFindingCount: number;
  flaggedBranches: string[];
  details: string;
}

// --- Reports ---

export interface SweepReport {
  startedAt: string;
  completedAt: string;
  repoPath: string;
  sweepBranch: string;
  totalRounds: number;
  maxRounds: number;
  exitReason: "zero-critical-high" | "max-rounds";
  strategy?: "single-pass" | "two-pass";
  rounds: SweepRoundResult[];
  remaining: SweepRemaining[];
  manualActions: ManualAction[];
}

export interface SweepRemaining {
  clusterId: string;
  file: string;
  line: number | null;
  severity: string;
  category: string;
  task: string;
  rationale: string;
  reason: "not-fixed" | "fix-failed" | "no-changes";
}

export interface SweepRegressionReport {
  sweepBranch: string;
  regressions: Array<{
    round: number;
    layer: number;
    previousLayerTasks: string[];
    flaggedBranches: string[];
    newCriticalHighCount: number;
    details: string;
  }>;
}

// --- Manual actions ---

export interface ManualAction {
  action: string;
  clusterId: string;
  file: string;
  category: string;
  severity: string;
  agent: string;
  branch: string;
}

// --- Helpers ---

export function countCriticalHigh(clusters: SuggestionCluster[]): number {
  return clusters.filter(
    (c) => c.severity === "critical" || c.severity === "high",
  ).length;
}
