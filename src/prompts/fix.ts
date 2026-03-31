import type { SuggestionCluster } from "../dedup/index.js";

/**
 * Extract the FIX_CONTEXT block from a fixer agent's raw output.
 * Searches through JSON wrappers and plain text.
 */
export function extractFixerContext(rawOutput: string): string | null {
  const match = rawOutput.match(/<FIX_CONTEXT>([\s\S]*?)<\/FIX_CONTEXT>/);
  if (match?.[1]?.trim()) return match[1].trim();

  // Also check inside JSON wrapper text fields
  try {
    const wrapper = JSON.parse(rawOutput) as Record<string, unknown>;
    for (const key of ["result", "response", "structured_output"]) {
      const val = wrapper[key];
      const text = typeof val === "string" ? val : typeof val === "object" ? JSON.stringify(val) : null;
      if (!text) continue;
      const inner = text.match(/<FIX_CONTEXT>([\s\S]*?)<\/FIX_CONTEXT>/);
      if (inner?.[1]?.trim()) return inner[1].trim();
    }
  } catch {
    // Not JSON
  }

  return null;
}

/**
 * Build a prompt that instructs an agent to apply a fix for a specific
 * suggestion cluster. The agent will have write access to the repo.
 */
export function buildFixPrompt(cluster: SuggestionCluster, repoContext?: string): string {
  const location = cluster.line
    ? `${cluster.file}:${cluster.line}`
    : cluster.file;

  const rationaleSection = cluster.rationales
    .map((r) => `- ${r.agent}: ${r.rationale}`)
    .join("\n");

  const changeSection = cluster.suggestedChange
    ? `\nSuggested fix:\n${cluster.suggestedChange}`
    : "";

  const contextBlock = repoContext ? `\n${repoContext}\n` : "";

  return `You are a senior developer fixing a ${cluster.category} issue found during a code review.
${contextBlock}
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

Apply the fix now.

After applying the fix, output a context block in this exact format:
<FIX_CONTEXT>
Approach: [what you changed and why this approach]
Alternatives rejected: [other approaches you considered but did not use, with reasons]
Tradeoffs: [any limitations, downsides, or scope boundaries of this fix]
</FIX_CONTEXT>`;
}

/**
 * Build a prompt that instructs an agent to fix multiple issues in the same
 * file in a single pass. All clusters must share the same `file` property.
 *
 * Used by the serial-phase grouping optimization to avoid one worktree/agent
 * session per finding when a file has many findings.
 */
export function buildMultiFixPrompt(
  clusters: SuggestionCluster[],
  repoContext?: string,
): string {
  const file = clusters[0]!.file;
  const n = clusters.length;
  const contextBlock = repoContext ? `\n${repoContext}\n` : "";

  const issueBlocks = clusters.map((cluster, i) => {
    const location = cluster.line
      ? `${cluster.file}:${cluster.line}`
      : cluster.file;

    const rationales = cluster.rationales
      .map((r) => `- ${r.agent}: ${r.rationale}`)
      .join("\n");

    const change = cluster.suggestedChange
      ? `\nSuggested fix:\n${cluster.suggestedChange}`
      : "";

    return `--- Issue ${i + 1} of ${n} [${cluster.id}] ---
LOCATION: ${location}
SEVERITY: ${cluster.severity} | CATEGORY: ${cluster.category}
FOUND BY: ${cluster.agents.join(", ")}

RATIONALE:
${rationales}${change}`;
  }).join("\n\n");

  return `You are a senior developer fixing multiple issues in the same file found during a code review.
${contextBlock}
TARGET FILE: ${file}

ISSUES TO FIX (${n} total):

${issueBlocks}

INSTRUCTIONS:
1. Read the file at ${file}
2. Understand ALL ${n} issues described above
3. Apply minimal, targeted fixes for EACH issue
4. Fixes may interact — ensure they are compatible with each other
5. Do NOT refactor surrounding code or make unrelated changes
6. Do NOT add comments explaining fixes unless the logic is non-obvious

Apply all fixes now.

After applying all fixes, output a context block in this exact format:
<FIX_CONTEXT>
Approach: [what you changed for each issue and why]
Alternatives rejected: [other approaches you considered but did not use, with reasons]
Tradeoffs: [any limitations, downsides, or scope boundaries of these fixes]
</FIX_CONTEXT>`;
}

/**
 * Build a retry prompt that gives the agent context about the failed attempt:
 * the original finding, the diff that was rejected, and the reviewer's concern.
 */
export function buildRetryFixPrompt(
  cluster: SuggestionCluster,
  failedDiff: string,
  concern: string,
  repoContext?: string,
): string {
  const location = cluster.line
    ? `${cluster.file}:${cluster.line}`
    : cluster.file;

  const rationaleSection = cluster.rationales
    .map((r) => `- ${r.agent}: ${r.rationale}`)
    .join("\n");

  const changeSection = cluster.suggestedChange
    ? `\nSuggested fix:\n${cluster.suggestedChange}`
    : "";

  const contextBlock = repoContext ? `\n${repoContext}\n` : "";

  return `You are a senior developer fixing a ${cluster.category} issue found during a code review.
${contextBlock}
A previous fix attempt was REJECTED by a reviewer. You must apply a DIFFERENT, better fix.

ISSUE LOCATION: ${location}
SEVERITY: ${cluster.severity}
CATEGORY: ${cluster.category}
FOUND BY: ${cluster.agents.join(", ")}

RATIONALE:
${rationaleSection}
${changeSection}

PREVIOUS FIX THAT WAS REJECTED:
\`\`\`diff
${failedDiff}
\`\`\`

REVIEWER'S CONCERN:
${concern}

INSTRUCTIONS:
1. Read the file at ${cluster.file}${cluster.line ? ` around line ${cluster.line}` : ""}
2. Understand both the original issue AND why the previous fix was rejected
3. Apply a DIFFERENT fix that addresses the original issue while resolving the reviewer's concern
4. Do NOT repeat the same approach that was rejected
5. Do NOT refactor surrounding code or make unrelated changes
6. Do NOT add comments explaining the fix unless the logic is non-obvious

Apply the fix now.

After applying the fix, output a context block in this exact format:
<FIX_CONTEXT>
Approach: [what you changed and why this approach]
Alternatives rejected: [other approaches you considered but did not use, with reasons]
Tradeoffs: [any limitations, downsides, or scope boundaries of this fix]
</FIX_CONTEXT>`;
}
