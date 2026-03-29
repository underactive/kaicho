import type { SuggestionCluster } from "../dedup/index.js";

const CATEGORY_SCOPE: Record<string, { scope: string; outOfScope: string; unrelated: string }> = {
  security: {
    scope: "Eliminate the specific vulnerability or unsafe pattern",
    outOfScope: "Code style, performance optimizations, documentation gaps, unrelated refactors",
    unrelated: "style, performance, maintainability, or documentation",
  },
  bug: {
    scope: "Fix the incorrect behavior described in the finding",
    outOfScope: "Code style, security hardening beyond the bug, performance tuning, documentation",
    unrelated: "style, security, performance, or documentation",
  },
  performance: {
    scope: "Address the specific performance issue (latency, memory, CPU)",
    outOfScope: "Code style, unrelated security concerns, documentation, feature changes",
    unrelated: "style, security, maintainability, or documentation",
  },
  maintainability: {
    scope: "Improve the specific maintainability issue (complexity, coupling, readability)",
    outOfScope: "Performance tuning, security hardening, feature changes, documentation",
    unrelated: "performance, security, style, or documentation",
  },
  style: {
    scope: "Fix the specific style or formatting issue",
    outOfScope: "Logic changes, security, performance, documentation",
    unrelated: "security, performance, maintainability, or documentation",
  },
  documentation: {
    scope: "Fix the specific documentation issue (missing, outdated, or incorrect docs)",
    outOfScope: "Code logic changes, style fixes, security, performance",
    unrelated: "security, performance, maintainability, or style",
  },
};

const DEFAULT_SCOPE = {
  scope: "Fix the specific issue described in the finding",
  outOfScope: "Unrelated concerns outside the stated category",
  unrelated: "other categories",
};

/**
 * Build a prompt that asks a reviewer agent to evaluate a fix diff.
 * The reviewer should return a structured verdict.
 */
export function buildValidationPrompt(
  cluster: SuggestionCluster,
  diff: string,
  fixerContext?: string | null,
  repoContext?: string,
): string {
  const location = cluster.line
    ? `${cluster.file}:${cluster.line}`
    : cluster.file;

  const rationaleSection = cluster.rationales
    .map((r) => `- ${r.agent}: ${r.rationale}`)
    .join("\n");

  const catScope = CATEGORY_SCOPE[cluster.category] ?? DEFAULT_SCOPE;

  const contextBlock = repoContext ? `\n${repoContext}\n` : "";

  return `You are a code reviewer validating a fix applied by another AI agent.
${contextBlock}
ORIGINAL FINDING:
Location: ${location}
Severity: ${cluster.severity}
Category: ${cluster.category}

Rationale:
${rationaleSection}

DIFF APPLIED:
\`\`\`diff
${diff}
\`\`\`
${fixerContext ? `
FIXER'S DECISION CONTEXT:
${fixerContext}
` : ""}
## Review Context
- Issue type: ${cluster.category}
- Scope: ${catScope.scope}
- Out of scope: ${catScope.outOfScope}

Evaluate ONLY whether the fix resolves the stated issue without introducing a new defect of the same category.

A ${cluster.category} fix should NOT be rejected for concerns about ${catScope.unrelated}.

Your ONLY job is to determine:
1. Does this change fix the reported ${cluster.category} issue? (yes/no)
2. Does it introduce a regression or break existing tests? (yes/no)
3. Does it introduce a NEW critical defect within ${cluster.category}? (yes/no)

If all answers are satisfactory, you MUST approve.
Do NOT comment on style, alternative approaches, or hypothetical edge cases.

Respond with ONLY a JSON object in this exact format:
{"verdict": "approve" or "concern", "rationale": "one paragraph explaining your assessment"}

If the fix is correct and complete, use "approve".
If you have any concerns about correctness, completeness, or regressions, use "concern".`;
}

export interface ValidationResult {
  verdict: "approve" | "concern";
  rationale: string;
}

/**
 * Pick a reviewer agent different from the fixer.
 * If a reviewer pool is provided, pick randomly from it (excluding the fixer).
 * Otherwise: prefer agents that found the issue, then any available agent.
 */
export function pickReviewer(
  fixAgent: string,
  clusterAgents: string[],
  allAgents: string[],
  reviewerPool?: string[],
): string | null {
  // Pool provided: pick randomly from eligible members
  if (reviewerPool && reviewerPool.length > 0) {
    const eligible = reviewerPool.filter((a) => a !== fixAgent);
    if (eligible.length > 0) {
      return eligible[Math.floor(Math.random() * eligible.length)]!;
    }
  }

  // First: try agents that found the issue (excluding the fixer)
  for (const agent of clusterAgents) {
    if (agent !== fixAgent) return agent;
  }

  // Second: try any other installed agent
  for (const agent of allAgents) {
    if (agent !== fixAgent) return agent;
  }

  // Only 1 agent available — can't validate
  return null;
}
