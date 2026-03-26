import { Command } from "commander";
import { runScan } from "../../orchestrator/index.js";
import { formatHuman, formatMultiHuman } from "../formatters/human.js";
import { formatMultiJson } from "../formatters/json.js";

export const scanCommand = new Command("scan")
  .description("Run an agent scan against a repository")
  .option("--agent <agent>", "Agent to use (omit for all available)")
  .option("--task <task>", "Task to run", "security")
  .option("--repo <path>", "Path to target repository", ".")
  .option("--timeout <ms>", "Agent timeout in milliseconds", "300000")
  .option("--scope <dirs>", "Limit scan to directories (comma-separated, e.g. src,lib)")
  .option("--files <patterns>", "Limit scan to file patterns (comma-separated, e.g. *.ts,*.js)")
  .option("--json", "Force JSON output")
  .option("--verbose", "Show detailed output")
  .option("--debug", "Show raw agent output")
  .action(async (opts) => {
    const multiResult = await runScan({
      agent: opts.agent as string | undefined,
      task: opts.task as string,
      repoPath: opts.repo as string,
      timeoutMs: parseInt(opts.timeout as string, 10),
      scope: opts.scope as string | undefined,
      files: opts.files as string | undefined,
    });

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
