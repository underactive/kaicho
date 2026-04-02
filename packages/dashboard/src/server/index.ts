import * as path from "node:path";
import * as fs from "node:fs";
import Database from "better-sqlite3";
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

function openDb(repoPath: string): Database.Database {
  const dbPath = path.join(repoPath, ".kaicho", "kaicho.db");
  if (!fs.existsSync(dbPath)) {
    // Create the DB with tables so dashboard works even with no data
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath, { readonly: false });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  // Ensure tables exist for empty-database case
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, agent TEXT NOT NULL, task TEXT NOT NULL, repo_path TEXT NOT NULL, started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, status TEXT NOT NULL, suggestion_count INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE, file TEXT NOT NULL, line INTEGER, category TEXT NOT NULL, severity TEXT NOT NULL, rationale TEXT NOT NULL, suggested_change TEXT);
    CREATE TABLE IF NOT EXISTS fixes (id INTEGER PRIMARY KEY AUTOINCREMENT, cluster_id TEXT NOT NULL, file TEXT NOT NULL, agent TEXT NOT NULL, branch TEXT NOT NULL, fixed_at TEXT NOT NULL, line INTEGER, severity TEXT, category TEXT, rationale TEXT, diff TEXT, UNIQUE(cluster_id, branch));
    CREATE TABLE IF NOT EXISTS discarded_fixes (id INTEGER PRIMARY KEY AUTOINCREMENT, cluster_id TEXT NOT NULL, file TEXT NOT NULL, line INTEGER, category TEXT NOT NULL, severity TEXT NOT NULL, summary TEXT, fix_agent TEXT NOT NULL, fix_diff TEXT NOT NULL, fixer_context TEXT, reviewer TEXT, verdict TEXT, reviewer_rationale TEXT, retry_attempted INTEGER NOT NULL DEFAULT 0, discarded_at TEXT NOT NULL, reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sweep_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, repo_path TEXT NOT NULL, sweep_branch TEXT NOT NULL, total_rounds INTEGER NOT NULL, max_rounds INTEGER NOT NULL, exit_reason TEXT NOT NULL, strategy TEXT, report_json TEXT NOT NULL, regressions_json TEXT);
    CREATE TABLE IF NOT EXISTS enrichments (id INTEGER PRIMARY KEY AUTOINCREMENT, cluster_id TEXT NOT NULL, task TEXT, file TEXT NOT NULL, summary TEXT NOT NULL, model TEXT NOT NULL, generated_at TEXT NOT NULL, UNIQUE(cluster_id, task));
  `);
  return db;
}

export function createApp(repoPath: string): { app: Hono; db: Database.Database } {
  const db = openDb(repoPath);
  const app = new Hono();

  app.use("/api/*", cors());

  // API routes
  app.route("/api/sweeps", sweepRoutes(db));
  app.route("/api/runs", runRoutes(db));
  app.route("/api/clusters", clusterRoutes(db));
  app.route("/api/fixed", fixedRoutes(db, repoPath));
  app.route("/api/discarded", discardedRoutes(db));

  // Health check
  app.get("/api/health", (c) =>
    c.json({ status: "ok", repoPath }),
  );

  return { app, db };
}

export async function startServer(options: ServerOptions): Promise<void> {
  const { port = 3456, repoPath, open = true } = options;
  const resolvedRepo = path.resolve(repoPath);

  const { app, db } = createApp(resolvedRepo);

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
    process.stderr.write(`Reading data from ${resolvedRepo}/.kaicho/kaicho.db\n`);

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
      db.close();
      server.close();
      resolve();
    });
    process.on("SIGTERM", () => {
      db.close();
      server.close();
      resolve();
    });
  });
}
