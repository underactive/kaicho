import { Command } from "commander";
import { runScan } from "../../orchestrator/index.js";
import { formatHuman } from "../formatters/human.js";
import { formatJson } from "../formatters/json.js";

export const scanCommand = new Command("scan")
  .description("Run an agent scan against a repository")
  .option("--agent <agent>", "Agent to use", "codex")
  .option("--task <task>", "Task to run", "security")
  .option("--repo <path>", "Path to target repository", ".")
  .option("--timeout <ms>", "Agent timeout in milliseconds", "300000")
  .option("--json", "Force JSON output")
  .option("--verbose", "Show detailed output")
  .option("--debug", "Show raw agent output")
  .action(async (opts) => {
    const result = await runScan({
      agent: opts.agent as string,
      task: opts.task as string,
      repoPath: opts.repo as string,
      timeoutMs: parseInt(opts.timeout as string, 10),
    });

    const useJson = opts.json === true || !process.stdout.isTTY;

    if (useJson) {
      formatJson(result);
    } else {
      formatHuman(result, {
        verbose: opts.verbose === true,
        debug: opts.debug === true,
      });
    }

    process.exit(result.status === "success" ? 0 : 1);
  });
