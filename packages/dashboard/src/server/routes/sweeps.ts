import { Hono } from "hono";
import { readSweepReports, readSweepReport } from "../readers/sweep-reader.js";
import { readFixLog } from "../readers/fix-reader.js";
import { SWEEP_LAYERS } from "../types.js";

export function sweepRoutes(repoPath: string): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const reports = await readSweepReports(repoPath);
    return c.json(reports);
  });

  app.get("/:filename", async (c) => {
    const report = await readSweepReport(repoPath, c.req.param("filename"));
    if (!report) return c.json({ error: "Not found" }, 404);
    return c.json(report);
  });

  /**
   * Get layer-level detail for a specific sweep.
   * Returns remaining (unfixed) items filtered by layer tasks,
   * plus fixed entries from fixed.json.
   */
  app.get("/:index/layers/:layer", async (c) => {
    const index = parseInt(c.req.param("index"), 10);
    const layerNum = parseInt(c.req.param("layer"), 10);

    const reports = await readSweepReports(repoPath);
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

    // Get fixed entries (limited detail — no severity/rationale)
    const fixLog = await readFixLog(repoPath);

    return c.json({
      layer: layerNum,
      tasks: [...tasks],
      remaining,
      layerResults,
      fixLog,
      sweepBranch: report.sweepBranch,
    });
  });

  return app;
}
