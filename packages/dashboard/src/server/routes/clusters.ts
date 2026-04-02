import { Hono } from "hono";
import type Database from "better-sqlite3";
import { readClusters } from "../readers/cluster-reader.js";

export function clusterRoutes(db: Database.Database): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const task = c.req.query("task");
    const agent = c.req.query("agent");
    const minSeverity = c.req.query("minSeverity");

    let clusters = readClusters(db, {
      task: task || undefined,
      agent: agent || undefined,
    });

    if (minSeverity) {
      const SEVERITY_RANK: Record<string, number> = {
        critical: 0, high: 1, medium: 2, low: 3, info: 4,
      };
      const threshold = SEVERITY_RANK[minSeverity];
      if (threshold !== undefined) {
        clusters = clusters.filter((c) => (SEVERITY_RANK[c.severity] ?? 5) <= threshold);
      }
    }

    return c.json(clusters);
  });

  return app;
}
