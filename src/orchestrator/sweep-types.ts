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
  reviewer?: string;
  verbose?: boolean;
  /** Run a full re-scan after all rounds to populate the remaining-findings report. Off by default. */
  finalScan?: boolean;
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
  durationMs: number;
}

export interface SweepRoundResult {
  round: number;
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
  rounds: SweepRoundResult[];
  remaining: SweepRemaining[];
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

// --- Helpers ---

export function countCriticalHigh(clusters: SuggestionCluster[]): number {
  return clusters.filter(
    (c) => c.severity === "critical" || c.severity === "high",
  ).length;
}
