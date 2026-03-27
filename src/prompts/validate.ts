import type { SuggestionCluster } from "../dedup/index.js";

/**
 * Build a prompt that asks a reviewer agent to evaluate a fix diff.
 * The reviewer should return a structured verdict.
 */
export function buildValidationPrompt(
  cluster: SuggestionCluster,
  diff: string,
): string {
  const location = cluster.line
    ? `${cluster.file}:${cluster.line}`
    : cluster.file;

  const rationaleSection = cluster.rationales
    .map((r) => `- ${r.agent}: ${r.rationale}`)
    .join("\n");

  return `You are a code reviewer validating a fix applied by another AI agent.

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

Review this diff and determine:
1. Does it correctly address the original finding?
2. Does it introduce any new bugs, security issues, or regressions?
3. Is the fix complete, or does it miss edge cases?

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
 * Prefers agents that found the original issue (they have context).
 * Falls back to any available agent.
 */
export function pickReviewer(
  fixAgent: string,
  clusterAgents: string[],
  allAgents: string[],
): string | null {
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
