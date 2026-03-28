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
export interface CommitMessageReviewer {
  name: string;
  model?: string;
}

export function buildCommitMessage(
  cluster: SuggestionCluster,
  agent: string,
  model?: string,
  scanModels?: Record<string, string>,
  reviewer?: CommitMessageReviewer,
): string {
  const location = cluster.line ? `${cluster.file}:${cluster.line}` : cluster.file;

  // Title: use summary if available, otherwise truncate first rationale
  const title = cluster.summary
    ?? truncate(cluster.rationales[0]?.rationale ?? "fix applied", 72);

  const agentList = cluster.agents
    .map((a) => {
      const display = a.charAt(0).toUpperCase() + a.slice(1);
      const m = scanModels?.[a];
      return m ? `${display} (${m})` : display;
    })
    .join(", ");
  const agreement = cluster.agreement > 1 ? ` {${cluster.agreement}x agreement}` : "";
  const foundBy = `${agentList}${agreement}`;

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
  if (reviewer) {
    const reviewerDisplay = reviewer.name.charAt(0).toUpperCase() + reviewer.name.slice(1);
    const reviewerModel = reviewer.model ? ` (${reviewer.model})` : "";
    lines.push("", `Fixed by ${agentDisplay}${modelSuffix} and reviewed by ${reviewerDisplay}${reviewerModel}, applied via Kaichō`);
  } else {
    lines.push("", `Fixed by ${agentDisplay}${modelSuffix}, applied via Kaichō`);
  }

  return lines.join("\n");
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, " ");
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 1) + "…";
}
