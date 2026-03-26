import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { runScan } from "../../orchestrator/index.js";
import { loadConfig, mergeWithConfig } from "../../config/index.js";
import { filterBySeverity } from "../../dedup/index.js";
import { formatHuman, formatMultiHuman } from "../formatters/human.js";
import { formatMultiJson } from "../formatters/json.js";

export const scanCommand = new Command("scan")
  .description("Run an agent scan against a repository")
  .option("--agent <agent>", "Agent to use (omit for all available)")
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
      agent: opts.agent as string | undefined,
      task: opts.task as string | undefined,
      timeout: opts.timeout as string | undefined,
      scope: opts.scope as string | undefined,
      files: opts.files as string | undefined,
      minSeverity: opts.minSeverity as string | undefined,
    }, config);

    const multiResult = await runScan({
      agent: merged.agent,
      task: merged.task ?? "security",
      repoPath: rawRepo,
      timeoutMs: merged.timeout ? parseInt(String(merged.timeout), 10) : 300_000,
      scope: merged.scope,
      files: merged.files,
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
