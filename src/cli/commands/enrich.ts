import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { KAICHO_DIR, RUNS_DIR } from "../../config/index.js";
import { clusterSuggestions } from "../../dedup/index.js";
import type { SuggestionCluster } from "../../dedup/index.js";
import { summarizeClusters } from "../../summarizer/index.js";
import type { RunResult } from "../../types/index.js";
import type { RunRecord } from "../../suggestion-store/index.js";

function enrichedFileName(task?: string): string {
  return task ? `enriched-${task}.json` : "enriched.json";
}

export interface EnrichedEntry {
  /** Keyed by file path — stable across task types and clustering contexts */
  file: string;
  summary: string;
}

export interface EnrichedData {
  generatedAt: string;
  model: string;
  entries: EnrichedEntry[];
}

export const enrichCommand = new Command("enrich")
  .description("Generate short IDs and LLM summaries for scan findings")
  .option("--repo <path>", "Path to target repository", ".")
  .option("--task <task>", "Filter scan results by task type")
  .option("--model <model>", "Ollama model for summaries", "qwen3:1.7b")
  .option("--force", "Regenerate even if cache exists")
  .action(async (opts) => {
    const rawRepo = opts.repo as string;
    const repoPath = rawRepo.startsWith("~")
      ? path.join(os.homedir(), rawRepo.slice(1))
      : path.resolve(rawRepo);

    // Discover which tasks have scan results
    const tasks = opts.task
      ? [opts.task as string]
      : await discoverTasks(repoPath);

    if (tasks.length === 0) {
      process.stderr.write("  No scan results found. Run 'kaicho scan' first.\n\n");
      process.exit(1);
    }

    let totalCount = 0;

    for (const task of tasks) {
      const clusters = await loadClustersFromRuns(repoPath, task);
      if (clusters.length === 0) continue;

      // Load existing enrichment data if not forcing
      if (!opts.force) {
        await applyEnrichedCache(repoPath, clusters, task);
      }

      const needsSummary = clusters.filter((c) => !c.summary).length;
      if (needsSummary === 0) {
        process.stdout.write(`  [${task}] ${clusters.length} findings already enriched.\n`);
        continue;
      }

      process.stdout.write(`  [${task}] Summarizing ${needsSummary} finding${needsSummary === 1 ? "" : "s"} with ${opts.model as string}...\n`);

      const count = await summarizeClusters(clusters, {
        model: opts.model as string,
      });

      if (count === 0) {
        process.stderr.write("  Ollama not available or model not found. Install with: ollama pull qwen3:1.7b\n\n");
        process.exit(1);
      }

      await saveEnrichedCache(repoPath, clusters, opts.model as string, task);
      totalCount += count;
    }

    process.stdout.write(`\n  Enriched ${totalCount} finding${totalCount === 1 ? "" : "s"} across ${tasks.length} task${tasks.length === 1 ? "" : "s"}.\n\n`);
  });

async function loadClustersFromRuns(
  repoPath: string,
  task?: string,
): Promise<SuggestionCluster[]> {
  const runsDir = path.join(repoPath, KAICHO_DIR, RUNS_DIR);

  let files: string[];
  try {
    files = await fs.readdir(runsDir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

  let records: RunRecord[] = [];
  for (const file of jsonFiles) {
    try {
      const content = await fs.readFile(path.join(runsDir, file), "utf-8");
      records.push(JSON.parse(content) as RunRecord);
    } catch {
      continue;
    }
  }

  if (task) {
    records = records.filter((r) => r.task === task);
  }

  const seen = new Map<string, RunRecord>();
  for (const r of records) {
    if (!seen.has(r.agent)) seen.set(r.agent, r);
  }

  const results: RunResult[] = Array.from(seen.values()).map((r) => ({
    agent: r.agent,
    status: r.status as RunResult["status"],
    suggestions: r.suggestions,
    rawOutput: "",
    rawError: "",
    durationMs: r.durationMs,
    startedAt: r.startedAt,
    error: r.error,
  }));

  return clusterSuggestions(results);
}

async function discoverTasks(repoPath: string): Promise<string[]> {
  const runsDir = path.join(repoPath, KAICHO_DIR, RUNS_DIR);
  try {
    const files = await fs.readdir(runsDir);
    const tasks = new Set<string>();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await fs.readFile(path.join(runsDir, file), "utf-8");
        const record = JSON.parse(content) as { task?: string };
        if (record.task) tasks.add(record.task);
      } catch { continue; }
    }
    return Array.from(tasks);
  } catch {
    return [];
  }
}

async function saveEnrichedCache(
  repoPath: string,
  clusters: SuggestionCluster[],
  model: string,
  task?: string,
): Promise<void> {
  // Deduplicate by file (one summary per file, first one wins — highest priority cluster)
  const seen = new Set<string>();
  const entries: EnrichedEntry[] = [];
  for (const c of clusters) {
    if (!c.summary) continue;
    if (seen.has(c.file)) continue;
    seen.add(c.file);
    entries.push({ file: c.file, summary: c.summary });
  }

  const enriched: EnrichedData = {
    generatedAt: new Date().toISOString(),
    model,
    entries,
  };

  const cachePath = path.join(repoPath, KAICHO_DIR, enrichedFileName(task));
  await fs.writeFile(cachePath, JSON.stringify(enriched, null, 2), "utf-8");
}

/**
 * Apply cached enrichment data (summaries) to clusters.
 * Matches by file — stable regardless of clustering context.
 * Tries task-specific cache first, falls back to generic.
 */
export async function applyEnrichedCache(
  repoPath: string,
  clusters: SuggestionCluster[],
  task?: string,
): Promise<void> {
  // Try task-specific cache first, then generic
  const paths = task
    ? [path.join(repoPath, KAICHO_DIR, enrichedFileName(task)), path.join(repoPath, KAICHO_DIR, enrichedFileName())]
    : [path.join(repoPath, KAICHO_DIR, enrichedFileName())];

  let cachePath: string | null = null;
  for (const p of paths) {
    try {
      await fs.access(p);
      cachePath = p;
      break;
    } catch { continue; }
  }

  if (!cachePath) return;

  let data: EnrichedData;
  try {
    const content = await fs.readFile(cachePath, "utf-8");
    data = JSON.parse(content) as EnrichedData;
  } catch {
    return; // No cache
  }

  const summaryMap = new Map<string, string>();
  // Support both new format (entries) and old format (clusters) for backwards compat
  const rawEntries = (data.entries ?? (data as unknown as Record<string, unknown>)["clusters"] ?? []) as unknown as Array<Record<string, unknown>>;
  for (const entry of rawEntries) {
    const file = entry["file"] as string | undefined;
    const summary = entry["summary"] as string | undefined;
    if (file && summary) {
      summaryMap.set(file, summary);
    }
  }

  for (const cluster of clusters) {
    if (!cluster.summary) {
      const cached = summaryMap.get(cluster.file);
      if (cached) {
        cluster.summary = cached;
      }
    }
  }
}
