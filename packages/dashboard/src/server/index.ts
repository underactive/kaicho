import * as path from "node:path";
import * as fs from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { sweepRoutes } from "./routes/sweeps.js";
import { runRoutes } from "./routes/runs.js";
import { clusterRoutes } from "./routes/clusters.js";
import { fixedRoutes, discardedRoutes } from "./routes/fixed.js";

export interface ServerOptions {
  port?: number;
  repoPath: string;
  open?: boolean;
}

export function createApp(repoPath: string): Hono {
  const app = new Hono();

  app.use("/api/*", cors());

  // API routes
  app.route("/api/sweeps", sweepRoutes(repoPath));
  app.route("/api/runs", runRoutes(repoPath));
  app.route("/api/clusters", clusterRoutes(repoPath));
  app.route("/api/fixed", fixedRoutes(repoPath));
  app.route("/api/discarded", discardedRoutes(repoPath));

  // Health check
  app.get("/api/health", (c) =>
    c.json({ status: "ok", repoPath }),
  );

  return app;
}

export async function startServer(options: ServerOptions): Promise<void> {
  const { port = 3456, repoPath, open = true } = options;
  const resolvedRepo = path.resolve(repoPath);

  const app = createApp(resolvedRepo);

  // Serve the built SPA from dist/client/ (resolved relative to this file)
  const clientDir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "client",
  );

  if (fs.existsSync(clientDir)) {
    app.use("/*", serveStatic({ root: clientDir }));
    // SPA fallback: serve index.html for unmatched routes
    app.get("*", async (c) => {
      const indexPath = path.join(clientDir, "index.html");
      const html = await fs.promises.readFile(indexPath, "utf-8");
      return c.html(html);
    });
  }

  const server = serve({ fetch: app.fetch, port }, () => {
    const url = `http://localhost:${port}`;
    process.stderr.write(`Dashboard running at ${url}\n`);
    process.stderr.write(`Reading data from ${resolvedRepo}/.kaicho/\n`);

    if (open) {
      // macOS: open in browser
      import("node:child_process").then(({ exec }) => {
        exec(`open ${url}`);
      }).catch(() => {
        // Silently skip if open fails
      });
    }
  });

  // Keep alive until Ctrl+C
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      process.stderr.write("\nShutting down dashboard...\n");
      server.close();
      resolve();
    });
    process.on("SIGTERM", () => {
      server.close();
      resolve();
    });
  });
}
