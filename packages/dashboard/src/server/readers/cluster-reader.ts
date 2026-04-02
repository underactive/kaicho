import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { SuggestionCluster } from "../types.js";
import { SEVERITY_RANK } from "../types.js";
import { readRunRecords, type RunFilter } from "./run-reader.js";
import { getFixedClusterIds } from "./fix-reader.js";

const LINE_PROXIMITY = 5;
const SIMILARITY_THRESHOLD = 0.35;

/**
 * Load run records and compute clusters from them, annotating with fix status.
 * This replicates the CLI's clustering algorithm as a pure read-only computation.
 */
export function readClusters(db: Database.Database, filter?: RunFilter): SuggestionCluster[] {
  const records = readRunRecords(db, filter);
  const fixedIds = getFixedClusterIds(db);

  // Build RunResult-like objects from RunRecords
  const results = records.map((r) => ({
    agent: r.agent,
    status: r.status as "success",
    suggestions: r.suggestions,
  }));

  const clusters = clusterSuggestions(results);

  // Annotate with fix status
  for (const cluster of clusters) {
    cluster.fixed = fixedIds.has(cluster.id);
  }

  return clusters;
}

// --- Clustering algorithm (mirrored from src/dedup/cluster.ts) ---

function generateClusterId(file: string, line: number | null, category: string): string {
  const bucket = line !== null ? Math.round(line / 10) * 10 : "null";
  const input = `${file}:${bucket}:${category}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 6);
}

interface MinimalResult {
  agent: string;
  status: string;
  suggestions: Array<{
    file: string;
    line: number | null;
    category: string;
    severity: string;
    rationale: string;
    suggestedChange: string | null;
  }>;
}

type MinimalSuggestion = MinimalResult["suggestions"][number];

interface MinimalAgentSuggestion {
  agent: string;
  suggestion: MinimalSuggestion;
}

function clusterSuggestions(results: MinimalResult[]): SuggestionCluster[] {
  const all: MinimalAgentSuggestion[] = [];
  for (const result of results) {
    if (result.status !== "success") continue;
    for (const suggestion of result.suggestions) {
      all.push({ agent: result.agent, suggestion });
    }
  }

  if (all.length === 0) return [];

  const byFile = new Map<string, MinimalAgentSuggestion[]>();
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
    const withLine = items.filter((i) => i.suggestion.line !== null);
    const withoutLine = items.filter((i) => i.suggestion.line === null);
    clusters.push(...clusterByLine(file, withLine));
    clusters.push(...clusterByCategory(file, withoutLine));
  }

  const merged = mergeSimilarClusters(clusters);

  merged.sort((a, b) => {
    if (b.agreement !== a.agreement) return b.agreement - a.agreement;
    return (SEVERITY_RANK[a.severity] ?? 5) - (SEVERITY_RANK[b.severity] ?? 5);
  });

  return merged;
}

function clusterByLine(file: string, items: MinimalAgentSuggestion[]): SuggestionCluster[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort(
    (a, b) => (a.suggestion.line ?? 0) - (b.suggestion.line ?? 0),
  );

  const clusters: SuggestionCluster[] = [];
  let current: MinimalAgentSuggestion[] = [sorted[0]!];

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

function clusterByCategory(file: string, items: MinimalAgentSuggestion[]): SuggestionCluster[] {
  if (items.length === 0) return [];

  const byCategory = new Map<string, MinimalAgentSuggestion[]>();
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

function mergeSimilarClusters(clusters: SuggestionCluster[]): SuggestionCluster[] {
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

    // Pass 2: Jaccard keyword similarity merge
    result.push(...mergeByKeywordSimilarity(file, afterFingerprint));
  }

  return result;
}

function mergeByKeywordSimilarity(file: string, clusters: SuggestionCluster[]): SuggestionCluster[] {
  const used = new Set<number>();
  const result: SuggestionCluster[] = [];
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

function rationaleKeywords(cluster: SuggestionCluster): Set<string> {
  const allText = cluster.rationales.map((r) => r.rationale).join(" ");
  return new Set(
    allText.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 4),
  );
}

function rationaleFingerprint(cluster: SuggestionCluster): string {
  const text = cluster.rationales[0]?.rationale ?? "";
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 4).slice(0, 6);
  return `${cluster.file}:${cluster.category}:${words.join(" ")}`;
}

function keywordSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function buildCluster(file: string, items: MinimalAgentSuggestion[]): SuggestionCluster {
  const agents = [...new Set(items.map((i) => i.agent))];

  const sorted = [...items].sort(
    (a, b) => (SEVERITY_RANK[a.suggestion.severity] ?? 5) - (SEVERITY_RANK[b.suggestion.severity] ?? 5),
  );
  const best = sorted[0]!;

  const lines = items
    .map((i) => i.suggestion.line)
    .filter((l): l is number => l !== null)
    .sort((a, b) => a - b);
  const medianLine = lines.length > 0 ? lines[Math.floor(lines.length / 2)]! : null;

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
    items: items as SuggestionCluster["items"],
  };
}
