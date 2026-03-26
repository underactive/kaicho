import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";

const DEFAULT_CONFIG = {
  task: "security",
  timeout: 300000,
  scope: null,
  files: null,
  minSeverity: null,
};

export const initCommand = new Command("init")
  .description("Create a kaicho.config.json in the target repository")
  .option("--repo <path>", "Path to target repository", ".")
  .action(async (opts) => {
    const rawRepo = opts.repo as string;
    const repoPath = rawRepo.startsWith("~")
      ? path.join(os.homedir(), rawRepo.slice(1))
      : path.resolve(rawRepo);

    const configPath = path.join(repoPath, "kaicho.config.json");

    try {
      await fs.access(configPath);
      process.stderr.write(`  kaicho.config.json already exists at ${configPath}\n\n`);
      process.exit(1);
    } catch {
      // File doesn't exist, good
    }

    await fs.writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
    process.stdout.write(`  Created ${configPath}\n\n`);
  });
