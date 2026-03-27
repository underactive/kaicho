import type { SuggestionCluster } from "../dedup/index.js";

/**
 * Build a prompt that instructs an agent to apply a fix for a specific
 * suggestion cluster. The agent will have write access to the repo.
 */
export function buildFixPrompt(cluster: SuggestionCluster): string {
  const location = cluster.line
    ? `${cluster.file}:${cluster.line}`
    : cluster.file;

  const rationaleSection = cluster.rationales
    .map((r) => `- ${r.agent}: ${r.rationale}`)
    .join("\n");

  const changeSection = cluster.suggestedChange
    ? `\nSuggested fix:\n${cluster.suggestedChange}`
    : "";

  return `You are a senior developer fixing a ${cluster.category} issue found during a code review.

ISSUE LOCATION: ${location}
SEVERITY: ${cluster.severity}
CATEGORY: ${cluster.category}
FOUND BY: ${cluster.agents.join(", ")}

RATIONALE:
${rationaleSection}
${changeSection}

INSTRUCTIONS:
1. Read the file at ${cluster.file}${cluster.line ? ` around line ${cluster.line}` : ""}
2. Understand the issue described above
3. Apply a minimal, targeted fix that addresses the issue
4. Do NOT refactor surrounding code or make unrelated changes
5. Do NOT add comments explaining the fix unless the logic is non-obvious
6. If the suggested fix is provided, follow it unless you see a better approach

Apply the fix now.`;
}
