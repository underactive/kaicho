import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { clusterSuggestions } from "../../dedup/index.js";
import type { SuggestionCluster } from "../../dedup/index.js";
import { summarizeClusters } from "../../summarizer/index.js";
import type { RunResult } from "../../types/index.js";
import { SqliteStore } from "../../suggestion-store/index.js";

export interface EnrichedEntry {
  /** Cluster ID — stable within the same task-scoped clustering context */
  id: string;
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
  .option("--model <model>", "Model for summaries (openrouter:<org>/<model> for remote, or Ollama model name)", "gemma3:1b")
  .option("--force", "Regenerate even if cache exists")
  .action(async (opts) => {
    const rawRepo = opts.repo as string;
    const repoPath = rawRepo.startsWith("~")
      ? path.join(os.homedir(), rawRepo.slice(1))
      : path.resolve(rawRepo);

    // Discover which tasks have scan results
    const tasks = opts.task
      ? [opts.task as string]
      : discoverTasks(repoPath);

    if (tasks.length === 0) {
      process.stderr.write("  No scan results found. Run 'kaicho scan' first.\n\n");
      process.exit(1);
    }

    let totalCount = 0;

    for (const task of tasks) {
      const clusters = loadClustersFromRuns(repoPath, task);
      if (clusters.length === 0) continue;

      // Load existing enrichment data if not forcing
      if (!opts.force) {
        applyEnrichedCache(repoPath, clusters, task);
      }

      const needsSummary = clusters.filter((c) => !c.summary).length;
      if (needsSummary === 0) {
        process.stdout.write(`  [${task}] ${clusters.length} findings already enriched.\n`);
        continue;
      }

      process.stdout.write(`  [${task}] Summarizing ${needsSummary} finding${needsSummary === 1 ? "" : "s"} with ${opts.model as string}...\n`);

      const isTTY = process.stderr.isTTY;
      const count = await summarizeClusters(clusters, {
        model: opts.model as string,
        onProgress: (p) => {
          if (isTTY) {
            // Overwrite line in-place for TTY
            process.stderr.write(`\r  [${task}] ${p.current}/${p.total} ${p.file} (${p.status})${"".padEnd(20)}`);
            if (p.current === p.total) process.stderr.write("\n");
          } else {
            // JSONL for piping / thin clients
            process.stderr.write(JSON.stringify({
              type: "enrich.progress",
              task,
              ...p,
            }) + "\n");
          }
        },
      });

      if (count === 0) {
        process.stderr.write("  Summarizer not available. For Ollama: ollama pull <model>. For remote: set OPENROUTER_API_KEY.\n\n");
        process.exit(1);
      }

      saveEnrichedCache(repoPath, clusters, opts.model as string, task);
      totalCount += count;
    }

    process.stdout.write(`\n  Enriched ${totalCount} finding${totalCount === 1 ? "" : "s"} across ${tasks.length} task${tasks.length === 1 ? "" : "s"}.\n\n`);
  });

function loadClustersFromRuns(
  repoPath: string,
  task?: string,
): SuggestionCluster[] {
  const store = new SqliteStore(repoPath);
  try {
    const records = store.readRunRecords({ task });

    // Keep only the latest run per agent (same dedup as before)
    const seen = new Map<string, (typeof records)[number]>();
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
  } finally {
    store.close();
  }
}

function discoverTasks(repoPath: string): string[] {
  const store = new SqliteStore(repoPath);
  try {
    return store.distinctTasks();
  } finally {
    store.close();
  }
}

function saveEnrichedCache(
  repoPath: string,
  clusters: SuggestionCluster[],
  model: string,
  task?: string,
): void {
  const store = new SqliteStore(repoPath);
  try {
    for (const c of clusters) {
      if (!c.summary) continue;
      store.saveEnrichment(c.id, c.file, c.summary, model, task);
    }
  } finally {
    store.close();
  }
}

/**
 * Apply cached enrichment data (summaries) to clusters.
 * Matches by cluster ID.
 */
export function applyEnrichedCache(
  repoPath: string,
  clusters: SuggestionCluster[],
  task?: string,
): void {
  const store = new SqliteStore(repoPath);
  try {
    const summaryById = store.loadEnrichments(task);
    for (const cluster of clusters) {
      if (!cluster.summary) {
        const cached = summaryById.get(cluster.id);
        if (cached) {
          cluster.summary = cached;
        }
      }
    }
  } finally {
    store.close();
  }
}
