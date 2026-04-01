import { Command } from "commander";
import * as path from "node:path";

export const uiCommand = new Command("ui")
  .description("Launch the Kaicho dashboard in your browser")
  .option("-p, --port <port>", "Port to serve on", "3456")
  .option("-r, --repo <path>", "Repository path to read .kaicho/ data from", ".")
  .option("--no-open", "Don't automatically open the browser")
  .action(async (opts: { port: string; repo: string; open: boolean }) => {
    const port = parseInt(opts.port, 10);
    const repoPath = path.resolve(opts.repo);

    // Dynamic import to avoid loading dashboard deps at CLI startup
    const { startServer } = await import("@kaicho/dashboard");
    await startServer({ port, repoPath, open: opts.open });
  });
