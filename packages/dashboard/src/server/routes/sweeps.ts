import { Hono } from "hono";
import type Database from "better-sqlite3";
import { readSweepReports, readSweepReport } from "../readers/sweep-reader.js";
import { readFixLog, readDiscardedLog } from "../readers/fix-reader.js";
import { SWEEP_LAYERS } from "../types.js";

export function sweepRoutes(db: Database.Database): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const reports = readSweepReports(db);
    return c.json(reports);
  });

  app.get("/:index", (c) => {
    const index = parseInt(c.req.param("index"), 10);
    const report = readSweepReport(db, index);
    if (!report) return c.json({ error: "Not found" }, 404);
    return c.json(report);
  });

  /**
   * Get layer-level detail for a specific sweep.
   * Returns remaining (unfixed) items filtered by layer tasks,
   * plus fixed entries from the fix log.
   */
  app.get("/:index/layers/:layer", (c) => {
    const index = parseInt(c.req.param("index"), 10);
    const layerNum = parseInt(c.req.param("layer"), 10);

    const reports = readSweepReports(db);
    const report = reports[index];
    if (!report) return c.json({ error: "Sweep not found" }, 404);

    const layerDef = SWEEP_LAYERS.find((l) => l.layer === layerNum);
    if (!layerDef) return c.json({ error: "Invalid layer" }, 404);

    const tasks = new Set(layerDef.tasks as string[]);

    // Get remaining (unfixed) items for this layer's tasks
    const remaining = report.remaining.filter((r) => tasks.has(r.task));

    // Get the layer result from rounds (aggregate stats)
    const layerResults = report.rounds.map((round) => ({
      round: round.round,
      pass: round.pass,
      result: round.layers.find((l) => l.layer === layerNum),
    })).filter((r) => r.result);

    // Get fixed entries
    const fixLog = readFixLog(db);

    // Get discarded fix entries for remaining items
    const allDiscarded = readDiscardedLog(db);
    const remainingIds = new Set(remaining.map((r) => r.clusterId));
    const discardedFixes = allDiscarded.filter((d) => remainingIds.has(d.clusterId));

    return c.json({
      layer: layerNum,
      tasks: [...tasks],
      remaining,
      layerResults,
      fixLog,
      discardedFixes,
      sweepBranch: report.sweepBranch,
    });
  });

  return app;
}
