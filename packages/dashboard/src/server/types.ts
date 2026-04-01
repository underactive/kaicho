// Types mirroring .kaicho/ JSON file schemas.
// These are read-only mirrors — the CLI owns the canonical definitions.

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Category = "security" | "bug" | "performance" | "maintainability" | "style" | "documentation";
export type ScanTask = "security" | "qa" | "docs" | "contracts" | "state" | "resources" | "testing" | "dx" | "performance" | "resilience" | "logging";

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

export interface AgentSuggestion {
  agent: string;
  suggestion: Suggestion;
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
  items: AgentSuggestion[];
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

// --- Sweep types ---

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

export const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
