import type { SuggestionCluster } from "../dedup/index.js";

/**
 * Build a descriptive commit message from a SuggestionCluster.
 *
 * Format:
 *   fix(<id>): <summary or first rationale truncated>
 *
 *   File: <file>:<line>
 *   Severity: <severity> | Category: <category>
 *   Found by: <agents>
 *
 *   <full rationale from primary agent>
 *
 *   Suggested change: <suggestedChange>
 *
 *   Applied by Kaichō via <agent>
 */
export function buildCommitMessage(cluster: SuggestionCluster, agent: string): string {
  const location = cluster.line ? `${cluster.file}:${cluster.line}` : cluster.file;

  // Title: use summary if available, otherwise truncate first rationale
  const title = cluster.summary
    ?? truncate(cluster.rationales[0]?.rationale ?? "fix applied", 72);

  const lines: string[] = [
    `fix(${cluster.id}): ${title}`,
    "",
    `File: ${location}`,
    `Severity: ${cluster.severity} | Category: ${cluster.category}`,
    `Found by: ${cluster.agents.join(", ")} (${cluster.agreement}x agreement)`,
  ];

  // Full rationale from each agent
  for (const r of cluster.rationales) {
    lines.push("", `${r.agent}: ${r.rationale}`);
  }

  if (cluster.suggestedChange) {
    lines.push("", `Suggested change: ${cluster.suggestedChange}`);
  }

  const agentDisplay = agent.charAt(0).toUpperCase() + agent.slice(1);
  lines.push("", `Applied by Kaichō via ${agentDisplay}`);

  return lines.join("\n");
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, " ");
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 1) + "…";
}
