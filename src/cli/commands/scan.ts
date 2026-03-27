import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { runScan, type ScanProgress } from "../../orchestrator/index.js";
import { loadConfig, mergeWithConfig, DEFAULT_TIMEOUT_MS } from "../../config/index.js";
import { filterBySeverity } from "../../dedup/index.js";
import { formatHuman, formatMultiHuman } from "../formatters/human.js";
import { formatMultiJson } from "../formatters/json.js";

export const scanCommand = new Command("scan")
  .description("Run an agent scan against a repository")
  .option("--agents <agents>", "Agents to run (comma-separated, default: all available)")
  .option("--exclude <agents>", "Exclude agents (comma-separated)")
  .option("--task <task>", "Task to run")
  .option("--repo <path>", "Path to target repository", ".")
  .option("--timeout <ms>", "Agent timeout in milliseconds")
  .option("--scope <dirs>", "Limit scan to directories (comma-separated, e.g. src,lib)")
  .option("--files <patterns>", "Limit scan to file patterns (comma-separated, e.g. *.ts,*.js)")
  .option("--min-severity <level>", "Minimum severity to show (critical, high, medium, low, info)")
  .option("--json", "Force JSON output")
  .option("--verbose", "Show detailed output")
  .option("--debug", "Show raw agent output")
  .action(async (opts) => {
    // Resolve repo path for config loading
    const rawRepo = opts.repo as string;
    const repoPath = rawRepo.startsWith("~")
      ? path.join(os.homedir(), rawRepo.slice(1))
      : path.resolve(rawRepo);

    // Load config, then merge (CLI flags override config)
    const config = await loadConfig(repoPath);
    const merged = mergeWithConfig({
      task: opts.task as string | undefined,
      timeout: opts.timeout as string | undefined,
      scope: opts.scope as string | undefined,
      files: opts.files as string | undefined,
      minSeverity: opts.minSeverity as string | undefined,
    }, config);

    const isTTY = process.stderr.isTTY;

    const onProgress = (p: ScanProgress): void => {
      if (isTTY) {
        if (p.status === "started") {
          process.stderr.write(`  [${p.agent}] scanning...\n`);
        } else if (p.status === "done") {
          const dur = p.durationMs ? `${(p.durationMs / 1000).toFixed(1)}s` : "";
          if (p.error) {
            process.stderr.write(`  [${p.agent}] ${p.error} ${dur}\n`);
          } else {
            process.stderr.write(`  [${p.agent}] ${p.suggestions ?? 0} suggestions ${dur}\n`);
          }
        } else if (p.status === "skipped") {
          process.stderr.write(`  [${p.agent}] skipped — not installed\n`);
        }
      } else {
        process.stderr.write(JSON.stringify({ type: "scan.progress", ...p }) + "\n");
      }
    };

    const agentsList = opts.agents ? (opts.agents as string).split(",").map((s: string) => s.trim()) : undefined;
    const excludeList = opts.exclude ? (opts.exclude as string).split(",").map((s: string) => s.trim()) : undefined;

    const multiResult = await runScan({
      agents: agentsList,
      exclude: excludeList,
      task: merged.task ?? "security",
      repoPath: rawRepo,
      timeoutMs: merged.timeout ? parseInt(String(merged.timeout), 10) : DEFAULT_TIMEOUT_MS,
      scope: merged.scope,
      files: merged.files,
      models: config.models,
      retention: config.retention,
      summarizerModel: config.summarizerModel,
      onProgress,
    });

    if (merged.minSeverity) {
      multiResult.clusters = filterBySeverity(multiResult.clusters, merged.minSeverity);
    }

    const useJson = opts.json === true || !process.stdout.isTTY;
    const formatOpts = {
      verbose: opts.verbose === true,
      debug: opts.debug === true,
    };

    if (useJson) {
      formatMultiJson(multiResult);
    } else if (multiResult.results.length === 1 && multiResult.results[0]) {
      formatHuman(multiResult.results[0], formatOpts);
    } else {
      formatMultiHuman(multiResult, formatOpts);
    }

    const hasSuccess = multiResult.results.some((r) => r.status === "success");
    process.exit(hasSuccess ? 0 : 1);
  });
