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
    const name = r.agent.charAt(0).toUpperCase() + r.agent.slice(1);
    lines.push("", `${name}: ${r.rationale}`);
  }

  if (cluster.suggestedChange) {
    lines.push("", `Suggested change: ${cluster.suggestedChange}`);
  }

  const fixer = formatAgent(agent, model);
  if (reviewer) {
    const rev = formatAgent(reviewer.name, reviewer.model);
    lines.push("", `Fixed by ${fixer} and reviewed by ${rev}, applied via Kaichō`);
  } else {
    lines.push("", `Fixed by ${fixer}, applied via Kaichō`);
  }

  return lines.join("\n");
}

/**
 * Format an agent name for display: strip the inline model specifier
 * (e.g. "cursor:comp" → "Cursor") and show the model in parentheses.
 * When no explicit model is provided, falls back to the inline specifier.
 */
function formatAgent(name: string, model?: string): string {
  const hasInlineModel = name.includes(":");
  const baseName = hasInlineModel ? name.split(":")[0]! : name;
  const display = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  const resolvedModel = model ?? (hasInlineModel ? name.split(":")[1] : undefined);
  return resolvedModel ? `${display} (${resolvedModel})` : display;
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, " ");
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 1) + "…";
}
