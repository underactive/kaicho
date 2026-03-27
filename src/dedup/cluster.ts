import { createHash } from "node:crypto";
import type { Suggestion, RunResult } from "../types/index.js";

export interface AgentSuggestion {
  agent: string;
  suggestion: Suggestion;
}

export interface SuggestionCluster {
  /** Stable short ID derived from file + line + category (4-char hex) */
  id: string;
  /** The canonical file for this cluster */
  file: string;
  /** Representative line (median of clustered lines, or null) */
  line: number | null;
  /** Category from the highest-severity suggestion */
  category: string;
  /** Highest severity in the cluster */
  severity: string;
  /** Which agents contributed to this cluster */
  agents: string[];
  /** Number of agents that found this (agreement count) */
  agreement: number;
  /** Merged rationale from all agents */
  rationales: Array<{ agent: string; rationale: string }>;
  /** Best suggested change (from highest-severity suggestion) */
  suggestedChange: string | null;
  /** One-line summary from local LLM (populated by enrich) */
  summary?: string;
  /** Whether this finding has been fixed (populated from fix log) */
  fixed?: boolean;
  /** All individual suggestions in this cluster */
  items: AgentSuggestion[];
}

/**
 * Generate a stable 4-char hex ID from file + line-bucket + category.
 * Lines are bucketed to nearest 10 so the ID stays stable even when
 * clustering produces slightly different median lines across runs.
 */
function generateClusterId(file: string, line: number | null, category: string): string {
  const bucket = line !== null ? Math.round(line / 10) * 10 : "null";
  const input = `${file}:${bucket}:${category}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 6);
}

const LINE_PROXIMITY = 5;

export const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Filter clusters to only include those at or above a minimum severity.
 */
export function filterBySeverity(
  clusters: SuggestionCluster[],
  minSeverity: string,
): SuggestionCluster[] {
  const threshold = SEVERITY_RANK[minSeverity];
  if (threshold === undefined) return clusters;
  return clusters.filter((c) => (SEVERITY_RANK[c.severity] ?? 5) <= threshold);
}

/**
 * Deduplicate suggestions across agents by clustering nearby findings
 * on the same file.
 *
 * Algorithm:
 * 1. Flatten all agent suggestions into AgentSuggestion pairs
 * 2. Group by file
 * 3. Within each file, sort by line and greedily cluster suggestions
 *    within ±LINE_PROXIMITY lines of each other
 * 4. Null-line suggestions cluster by file + category
 * 5. Rank clusters by agreement count, then severity
 */
export function clusterSuggestions(results: RunResult[]): SuggestionCluster[] {
  // Flatten
  const all: AgentSuggestion[] = [];
  for (const result of results) {
    if (result.status !== "success") continue;
    for (const suggestion of result.suggestions) {
      all.push({ agent: result.agent, suggestion });
    }
  }

  if (all.length === 0) return [];

  // Group by file
  const byFile = new Map<string, AgentSuggestion[]>();
  for (const item of all) {
    const key = item.suggestion.file;
    const existing = byFile.get(key);
    if (existing) {
      existing.push(item);
    } else {
      byFile.set(key, [item]);
    }
  }

  const clusters: SuggestionCluster[] = [];

  for (const [file, items] of byFile) {
    // Separate line-based and null-line suggestions
    const withLine = items.filter((i) => i.suggestion.line !== null);
    const withoutLine = items.filter((i) => i.suggestion.line === null);

    // Cluster line-based suggestions by proximity
    clusters.push(...clusterByLine(file, withLine));

    // Cluster null-line suggestions by category
    clusters.push(...clusterByCategory(file, withoutLine));
  }

  // Second pass: merge clusters on the same file with similar rationale text.
  // This catches the case where multiple agents flag the same conceptual issue
  // on different lines (e.g., LICENSE mismatch mentioned at lines 88, 302, 400).
  const merged = mergeSimilarClusters(clusters);

  // Sort: agreement desc, then severity asc (critical first)
  merged.sort((a, b) => {
    if (b.agreement !== a.agreement) return b.agreement - a.agreement;
    return (SEVERITY_RANK[a.severity] ?? 5) - (SEVERITY_RANK[b.severity] ?? 5);
  });

  return merged;
}

function clusterByLine(file: string, items: AgentSuggestion[]): SuggestionCluster[] {
  if (items.length === 0) return [];

  // Sort by line number
  const sorted = [...items].sort(
    (a, b) => (a.suggestion.line ?? 0) - (b.suggestion.line ?? 0),
  );

  const clusters: SuggestionCluster[] = [];
  let current: AgentSuggestion[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]!;
    const prevLine = current[current.length - 1]!.suggestion.line ?? 0;
    const thisLine = item.suggestion.line ?? 0;

    if (thisLine - prevLine <= LINE_PROXIMITY) {
      current.push(item);
    } else {
      clusters.push(buildCluster(file, current));
      current = [item];
    }
  }

  clusters.push(buildCluster(file, current));
  return clusters;
}

function clusterByCategory(file: string, items: AgentSuggestion[]): SuggestionCluster[] {
  if (items.length === 0) return [];

  const byCategory = new Map<string, AgentSuggestion[]>();
  for (const item of items) {
    const key = item.suggestion.category;
    const existing = byCategory.get(key);
    if (existing) {
      existing.push(item);
    } else {
      byCategory.set(key, [item]);
    }
  }

  return Array.from(byCategory.values()).map((group) => buildCluster(file, group));
}

/**
 * Merge clusters on the same file that have similar rationale text.
 * Uses a normalized fingerprint of the rationale (first N significant words)
 * to detect when multiple clusters describe the same conceptual issue.
 */
function mergeSimilarClusters(clusters: SuggestionCluster[]): SuggestionCluster[] {
  // Group by file first
  const byFile = new Map<string, SuggestionCluster[]>();
  for (const c of clusters) {
    const existing = byFile.get(c.file);
    if (existing) {
      existing.push(c);
    } else {
      byFile.set(c.file, [c]);
    }
  }

  const result: SuggestionCluster[] = [];

  for (const [file, fileClusters] of byFile) {
    if (fileClusters.length <= 1) {
      result.push(...fileClusters);
      continue;
    }

    // Pass 1: exact fingerprint merge
    const byFingerprint = new Map<string, SuggestionCluster[]>();
    for (const c of fileClusters) {
      const fp = rationaleFingerprint(c);
      const existing = byFingerprint.get(fp);
      if (existing) {
        existing.push(c);
      } else {
        byFingerprint.set(fp, [c]);
      }
    }

    const afterFingerprint: SuggestionCluster[] = [];
    for (const [, group] of byFingerprint) {
      if (group.length === 1) {
        afterFingerprint.push(group[0]!);
      } else {
        const allItems = group.flatMap((c) => c.items);
        afterFingerprint.push(buildCluster(file, allItems));
      }
    }

    if (afterFingerprint.length <= 1) {
      result.push(...afterFingerprint);
      continue;
    }

    // Pass 2: Jaccard keyword similarity merge for remaining same-category clusters
    const merged = mergeByKeywordSimilarity(file, afterFingerprint);
    result.push(...merged);
  }

  return result;
}

/**
 * Greedily merge clusters on the same file that share enough keywords.
 * Only merges clusters with the same category.
 */
function mergeByKeywordSimilarity(
  file: string,
  clusters: SuggestionCluster[],
): SuggestionCluster[] {
  const used = new Set<number>();
  const result: SuggestionCluster[] = [];

  // Pre-compute keyword sets
  const keywords = clusters.map(rationaleKeywords);

  for (let i = 0; i < clusters.length; i++) {
    if (used.has(i)) continue;

    const group = [clusters[i]!];
    used.add(i);

    for (let j = i + 1; j < clusters.length; j++) {
      if (used.has(j)) continue;
      if (clusters[i]!.category !== clusters[j]!.category) continue;

      const sim = keywordSimilarity(keywords[i]!, keywords[j]!);
      if (sim >= SIMILARITY_THRESHOLD) {
        group.push(clusters[j]!);
        used.add(j);
      }
    }

    if (group.length === 1) {
      result.push(group[0]!);
    } else {
      const allItems = group.flatMap((c) => c.items);
      result.push(buildCluster(file, allItems));
    }
  }

  return result;
}

/**
 * Extract a normalized keyword set from a cluster's rationale.
 * Uses ALL rationales (not just the first), extracts significant words,
 * and returns a sorted set. Two clusters about the same issue will
 * share enough keywords to be detected as similar.
 */
function rationaleKeywords(cluster: SuggestionCluster): Set<string> {
  const allText = cluster.rationales.map((r) => r.rationale).join(" ");

  return new Set(
    allText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 4), // skip short/filler words
  );
}

/**
 * Compute a fingerprint for exact-match grouping (fast first pass).
 * Uses file + category + first 6 significant words from the primary rationale.
 */
function rationaleFingerprint(cluster: SuggestionCluster): string {
  const text = cluster.rationales[0]?.rationale ?? "";
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 6);

  return `${cluster.file}:${cluster.category}:${words.join(" ")}`;
}

/**
 * Compute Jaccard similarity between two keyword sets.
 * Returns 0-1 where 1 means identical.
 */
function keywordSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const SIMILARITY_THRESHOLD = 0.35;

function buildCluster(file: string, items: AgentSuggestion[]): SuggestionCluster {
  // Unique agents
  const agents = [...new Set(items.map((i) => i.agent))];

  // Pick highest severity
  const sorted = [...items].sort(
    (a, b) =>
      (SEVERITY_RANK[a.suggestion.severity] ?? 5) -
      (SEVERITY_RANK[b.suggestion.severity] ?? 5),
  );
  const best = sorted[0]!;

  // Median line
  const lines = items
    .map((i) => i.suggestion.line)
    .filter((l): l is number => l !== null)
    .sort((a, b) => a - b);
  const medianLine = lines.length > 0
    ? lines[Math.floor(lines.length / 2)]!
    : null;

  // Collect rationales (one per agent, dedup by agent)
  const seenAgents = new Set<string>();
  const rationales: Array<{ agent: string; rationale: string }> = [];
  for (const item of sorted) {
    if (!seenAgents.has(item.agent)) {
      seenAgents.add(item.agent);
      rationales.push({ agent: item.agent, rationale: item.suggestion.rationale });
    }
  }

  const category = best.suggestion.category;
  const id = generateClusterId(file, medianLine, category);

  return {
    id,
    file,
    line: medianLine,
    category,
    severity: best.suggestion.severity,
    agents,
    agreement: agents.length,
    rationales,
    suggestedChange: best.suggestion.suggestedChange,
    items,
  };
}
