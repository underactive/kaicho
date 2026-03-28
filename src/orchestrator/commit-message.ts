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
export function buildCommitMessage(
  cluster: SuggestionCluster,
  agent: string,
  model?: string,
  scanModels?: Record<string, string>,
): string {
  const location = cluster.line ? `${cluster.file}:${cluster.line}` : cluster.file;

  // Title: use summary if available, otherwise truncate first rationale
  const title = cluster.summary
    ?? truncate(cluster.rationales[0]?.rationale ?? "fix applied", 72);

  const foundBy = cluster.agents
    .map((a) => {
      const display = a.charAt(0).toUpperCase() + a.slice(1);
      const m = scanModels?.[a];
      return m ? `${display} (${m})` : display;
    })
    .join(", ");

  const lines: string[] = [
    `fix(${cluster.id}): ${title}`,
    "",
    `File: ${location}`,
    `Severity: ${cluster.severity} | Category: ${cluster.category}`,
    `Found by: ${foundBy}`,
  ];

  // Full rationale from each agent
  for (const r of cluster.rationales) {
    lines.push("", `${r.agent}: ${r.rationale}`);
  }

  if (cluster.suggestedChange) {
    lines.push("", `Suggested change: ${cluster.suggestedChange}`);
  }

  const agentDisplay = agent.charAt(0).toUpperCase() + agent.slice(1);
  const modelSuffix = model ? ` (${model})` : "";
  lines.push("", `Applied by Kaichō via ${agentDisplay}${modelSuffix}`);

  return lines.join("\n");
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, " ");
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 1) + "…";
}
