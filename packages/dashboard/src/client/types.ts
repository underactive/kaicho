// Client-side types mirroring the API response shapes

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Category = "security" | "bug" | "performance" | "maintainability" | "style" | "documentation";

export interface Suggestion {
  file: string;
  line: number | null;
  category: Category;
  severity: Severity;
  rationale: string;
  suggestedChange: string | null;
}

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

export interface SuggestionCluster {
  id: string;
  file: string;
  line: number | null;
  category: string;
  severity: string;
  agents: string[];
  agreement: number;
  rationales: Array<{ agent: string; rationale: string }>;
  suggestedChange: string | null;
  summary?: string;
  fixed?: boolean;
}

export interface FixLogEntry {
  clusterId: string;
  file: string;
  agent: string;
  branch: string;
  fixedAt: string;
  line?: number | null;
  severity?: string;
  category?: string;
  rationale?: string;
  diff?: string;
}

export interface DiscardedFixEntry {
  clusterId: string;
  file: string;
  line: number | null;
  category: string;
  severity: string;
  summary: string | null;
  fixAgent: string;
  fixDiff: string;
  fixerContext: string | null;
  reviewer: string | null;
  verdict: string | null;
  reviewerRationale: string | null;
  retryAttempted: boolean;
  discardedAt: string;
  reason: "user-discard" | "auto-concern" | "retry-failed";
}

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

export const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-sky-500",
  info: "bg-zinc-500",
};

export const SEVERITY_TEXT_COLORS: Record<string, string> = {
  critical: "text-red-400",
  high: "text-orange-400",
  medium: "text-yellow-400",
  low: "text-sky-400",
  info: "text-zinc-400",
};

export const LAYER_LABELS: Record<number, string> = {
  1: "Security",
  2: "QA",
  3: "Contracts & State",
  4: "Resources & Resilience",
  5: "Performance",
  6: "Logging",
  7: "Testing, Docs & DX",
};

export const LAYER_TASKS: Record<number, string[]> = {
  1: ["security"],
  2: ["qa"],
  3: ["contracts", "state"],
  4: ["resources", "resilience"],
  5: ["performance"],
  6: ["logging"],
  7: ["testing", "docs", "dx"],
};
