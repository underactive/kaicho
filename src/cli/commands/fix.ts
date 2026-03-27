import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { Command } from "commander";
import { KAICHO_DIR, RUNS_DIR } from "../../config/index.js";
import { clusterSuggestions, filterBySeverity } from "../../dedup/index.js";
import type { SuggestionCluster } from "../../dedup/index.js";
import { applyEnrichedCache } from "./enrich.js";
import { runFix, resolveFixBranch } from "../../orchestrator/index.js";
import type { RunResult } from "../../types/index.js";
import type { RunRecord } from "../../suggestion-store/index.js";

const NO_COLOR = "NO_COLOR" in process.env;

function color(text: string, code: string): string {
  if (NO_COLOR) return text;
  return `${code}${text}\x1b[0m`;
}

export const fixCommand = new Command("fix")
  .description("Apply a fix for a scan finding using an AI agent")
  .option("--repo <path>", "Path to target repository", ".")
  .option("--agent <agent>", "Agent to use for fixing (default: agent that found the issue)")
  .option("--cluster <n>", "Cluster number to fix (skip interactive picker)")
  .option("--id <hash>", "Fix a specific finding by short ID")
  .option("--task <task>", "Filter scan results by task type")
  .option("--timeout <ms>", "Agent timeout in milliseconds", "300000")
  .option("--min-severity <level>", "Minimum severity to show")
  .action(async (opts) => {
    const rawRepo = opts.repo as string;
    const repoPath = rawRepo.startsWith("~")
      ? path.join(os.homedir(), rawRepo.slice(1))
      : path.resolve(rawRepo);

    // Load clusters from past scan results
    const clusters = await loadClusters(repoPath, opts.task as string | undefined);
    let filtered = clusters;
    if (opts.minSeverity) {
      filtered = filterBySeverity(filtered, opts.minSeverity as string);
    }

    if (filtered.length === 0) {
      process.stderr.write("  No findings to fix. Run 'kaicho scan' first.\n\n");
      process.exit(1);
    }

    // Pick a cluster by --id, --cluster, or interactive picker
    let clusterIdx: number;
    if (opts.id) {
      const idStr = opts.id as string;
      clusterIdx = filtered.findIndex((c) => c.id === idStr);
      if (clusterIdx === -1) {
        process.stderr.write(`  No finding with ID "${idStr}". Run 'kaicho report' to see IDs.\n\n`);
        process.exit(1);
      }
    } else if (opts.cluster !== undefined) {
      clusterIdx = parseInt(opts.cluster as string, 10) - 1;
      if (clusterIdx < 0 || clusterIdx >= filtered.length) {
        process.stderr.write(`  Invalid cluster number. Choose 1-${filtered.length}.\n\n`);
        process.exit(1);
      }
    } else {
      // Show picker
      printClusterList(filtered);
      clusterIdx = await promptClusterChoice(filtered.length);
    }

    const cluster = filtered[clusterIdx]!;
    const location = cluster.line ? `${cluster.file}:${cluster.line}` : cluster.file;

    // Pick agent: CLI override > interactive choice for multi-agent > default
    let agentName: string;
    if (opts.agent) {
      agentName = opts.agent as string;
    } else if (cluster.agents.length > 1 && process.stdin.isTTY) {
      agentName = await promptAgentChoice(cluster.agents);
    } else {
      agentName = cluster.agents[0] ?? "claude";
    }

    process.stdout.write(`\n  Fixing ${color(`[${cluster.severity}]`, "\x1b[33m")} ${location} with ${color(agentName, "\x1b[1m")}...\n\n`);

    const result = await runFix({
      repoPath: rawRepo,
      cluster,
      agent: agentName,
      timeoutMs: parseInt(opts.timeout as string, 10),
    });

    if (result.status === "dirty-worktree") {
      process.stderr.write(`  ${color("Error:", "\x1b[31m")} ${result.error}\n\n`);
      process.exit(1);
    }

    if (result.status === "agent-error") {
      process.stderr.write(`  ${color("Error:", "\x1b[31m")} ${result.error}\n\n`);
      process.exit(1);
    }

    if (result.status === "no-changes") {
      process.stdout.write(`  Agent made no changes. Nothing to apply.\n\n`);
      process.exit(0);
    }

    // Show diff
    const duration = (result.durationMs / 1000).toFixed(1);
    process.stdout.write(`  ${color("Fix applied", "\x1b[32m")} on branch ${color(result.branch, "\x1b[1m")} (${result.filesChanged} file${result.filesChanged === 1 ? "" : "s"}, ${duration}s)\n\n`);

    if (result.diff) {
      process.stdout.write(result.diff + "\n\n");
    }

    // Ask user what to do
    const action = await promptAction(result.branch);

    await resolveFixBranch(rawRepo, result.branch, result.previousBranch, action);

    if (action === "keep") {
      process.stdout.write(`  Branch ${color(result.branch, "\x1b[1m")} kept. Review and merge when ready.\n\n`);
    } else {
      process.stdout.write(`  Branch discarded.\n\n`);
    }
  });

function printClusterList(clusters: SuggestionCluster[]): void {
  const out = process.stdout;
  out.write("\n  Findings from last scan:\n\n");

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    const location = c.line ? `${c.file}:${c.line}` : c.file;
    const badge = c.agreement > 1 ? color(` ${c.agreement}x`, "\x1b[32m") : "";
    const sev = color(`[${c.severity}]`, "\x1b[33m");
    const agents = color(`(${c.agents.join(", ")})`, "\x1b[90m");
    const idTag = color(c.id, "\x1b[90m");

    out.write(`  ${String(i + 1).padStart(3)}. ${idTag} ${sev} ${c.category} — ${location}${badge} ${agents}\n`);
    if (c.summary) {
      out.write(`       ${color(c.summary, "\x1b[37m")}\n`);
    }
  }

  out.write("\n");
}

async function promptClusterChoice(max: number): Promise<number> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answer = await rl.question(`  Which finding to fix? (1-${max}): `);
    const idx = parseInt(answer.trim(), 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= max) {
      process.stderr.write("  Invalid choice.\n\n");
      process.exit(1);
    }
    return idx;
  } finally {
    rl.close();
  }
}

async function promptAgentChoice(agents: string[]): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const options = agents.map((a, i) => `${i + 1}=${a}`).join(", ");
    const answer = await rl.question(`  Multiple agents found this. Fix with? (${options}): `);
    const idx = parseInt(answer.trim(), 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < agents.length) {
      return agents[idx]!;
    }
    // Default to first agent if invalid input
    return agents[0]!;
  } finally {
    rl.close();
  }
}

async function promptAction(branch: string): Promise<"keep" | "discard"> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answer = await rl.question(`  Keep branch ${branch}? (y/n): `);
    return answer.trim().toLowerCase().startsWith("y") ? "keep" : "discard";
  } finally {
    rl.close();
  }
}

async function loadClusters(
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

  // Get latest per agent
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

  const clusters = clusterSuggestions(results);
  await applyEnrichedCache(repoPath, clusters, task);
  return clusters;
}
