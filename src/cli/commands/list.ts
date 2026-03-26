import { Command } from "commander";
import { execa } from "execa";
import { AGENT_CONFIGS } from "../../config/index.js";

const NO_COLOR = "NO_COLOR" in process.env;

function color(text: string, code: string): string {
  if (NO_COLOR) return text;
  return `${code}${text}\x1b[0m`;
}

export const listCommand = new Command("list")
  .description("Show available agents and which are installed")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const agents = await Promise.all(
      Object.values(AGENT_CONFIGS).map(async (config) => {
        let installed = false;
        let version = "";
        try {
          const result = await execa(config.command, ["--version"]);
          installed = true;
          version = result.stdout.trim().split("\n")[0] ?? "";
        } catch {
          // not installed
        }
        return { name: config.name, command: config.command, installed, version };
      }),
    );

    if (opts.json === true || !process.stdout.isTTY) {
      process.stdout.write(JSON.stringify(agents, null, 2) + "\n");
      return;
    }

    const out = process.stdout;
    out.write("\n");
    for (const a of agents) {
      const status = a.installed
        ? color("installed", "\x1b[32m")
        : color("not found", "\x1b[31m");
      const ver = a.version ? color(` (${a.version})`, "\x1b[90m") : "";
      out.write(`  ${a.name.padEnd(8)} ${a.command.padEnd(8)} ${status}${ver}\n`);
    }

    const count = agents.filter((a) => a.installed).length;
    out.write(`\n  ${count}/${agents.length} agents available\n\n`);
  });
