import { Hono } from "hono";
import type Database from "better-sqlite3";
import { readFixLog, readDiscardedLog } from "../readers/fix-reader.js";
import { readBranchDetail } from "../readers/git-reader.js";

export function fixedRoutes(db: Database.Database, repoPath: string): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const entries = readFixLog(db);
    return c.json(entries);
  });

  /**
   * Get commit detail for a fix.
   * Query params:
   *   clusterId — the cluster ID (for sweep branch fallback search)
   *   sweepBranch — the sweep branch name (for fallback)
   */
  app.get("/branch/:branch", async (c) => {
    const branch = c.req.param("branch");
    const clusterId = c.req.query("clusterId");
    const sweepBranch = c.req.query("sweepBranch");

    const detail = await readBranchDetail(repoPath, branch, { clusterId, sweepBranch });
    if (!detail.exists) return c.json({ error: "Branch not found" }, 404);
    return c.json(detail);
  });

  return app;
}

export function discardedRoutes(db: Database.Database): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const entries = readDiscardedLog(db);
    return c.json(entries);
  });

  return app;
}
