import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { KAICHO_DIR, RUNS_DIR } from "../../config/index.js";
import { clusterSuggestions } from "../../dedup/index.js";
import { formatHuman, formatMultiHuman } from "../formatters/human.js";
import { formatMultiJson } from "../formatters/json.js";
import type { RunResult } from "../../types/index.js";
import type { RunRecord } from "../../suggestion-store/index.js";

export const reportCommand = new Command("report")
  .description("Display results from past scans without re-running agents")
  .option("--repo <path>", "Path to target repository", ".")
  .option("--agent <agent>", "Filter to a specific agent")
  .option("--task <task>", "Filter to a specific task (security, qa, docs)")
  .option("--last <n>", "Show last N runs (default: latest run per agent)")
  .option("--json", "Force JSON output")
  .option("--verbose", "Show detailed output")
  .action(async (opts) => {
    const repoPath = (opts.repo as string).startsWith("~")
      ? path.join(os.homedir(), (opts.repo as string).slice(1))
      : opts.repo as string;
    const absRepoPath = path.resolve(repoPath);
    const runsDir = path.join(absRepoPath, KAICHO_DIR, RUNS_DIR);

    let files: string[];
    try {
      files = await fs.readdir(runsDir);
    } catch {
      process.stderr.write(`  No scan results found in ${runsDir}\n`);
      process.stderr.write(`  Run 'kaicho scan --repo=${opts.repo as string}' first.\n\n`);
      process.exit(1);
    }

    // Filter to JSON files, sort by name (timestamp) descending
    const jsonFiles = files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    if (jsonFiles.length === 0) {
      process.stderr.write(`  No scan results found.\n\n`);
      process.exit(1);
    }

    // Load run records
    let records: RunRecord[] = [];
    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(runsDir, file), "utf-8");
        records.push(JSON.parse(content) as RunRecord);
      } catch {
        // Skip corrupted files
      }
    }

    // Filter by agent and task
    if (opts.agent) {
      records = records.filter((r) => r.agent === opts.agent);
    }
    if (opts.task) {
      records = records.filter((r) => r.task === opts.task);
    }

    // Get latest run per agent (or last N if specified)
    const lastN = opts.last ? parseInt(opts.last as string, 10) : undefined;
    const selected = lastN
      ? records.slice(0, lastN)
      : getLatestPerAgent(records);

    if (selected.length === 0) {
      process.stderr.write(`  No matching results found.\n\n`);
      process.exit(1);
    }

    // Convert to RunResult for formatter compatibility
    const results: RunResult[] = selected.map((r) => ({
      agent: r.agent,
      status: r.status as RunResult["status"],
      suggestions: r.suggestions,
      rawOutput: "",
      rawError: "",
      durationMs: r.durationMs,
      startedAt: r.startedAt,
      error: r.error,
    }));

    const clusters = clusterSuggestions(results);
    const totalSuggestions = results.reduce((sum, r) => sum + r.suggestions.length, 0);
    const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);

    const multi = { results, clusters, totalSuggestions, totalDurationMs };
    const useJson = opts.json === true || !process.stdout.isTTY;

    if (useJson) {
      formatMultiJson(multi);
    } else if (results.length === 1 && results[0]) {
      formatHuman(results[0], { verbose: opts.verbose === true });
    } else {
      formatMultiHuman(multi, { verbose: opts.verbose === true });
    }
  });

/**
 * Pick the most recent run for each unique agent.
 */
function getLatestPerAgent(records: RunRecord[]): RunRecord[] {
  const seen = new Map<string, RunRecord>();
  for (const r of records) {
    if (!seen.has(r.agent)) {
      seen.set(r.agent, r);
    }
  }
  return Array.from(seen.values());
}
