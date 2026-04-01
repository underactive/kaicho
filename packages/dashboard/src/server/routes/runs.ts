import { Hono } from "hono";
import { readRunRecords, readRunRecord } from "../readers/run-reader.js";

export function runRoutes(repoPath: string): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const task = c.req.query("task");
    const agent = c.req.query("agent");
    const records = await readRunRecords(repoPath, {
      task: task || undefined,
      agent: agent || undefined,
    });
    return c.json(records);
  });

  app.get("/:filename", async (c) => {
    const record = await readRunRecord(repoPath, c.req.param("filename"));
    if (!record) return c.json({ error: "Not found" }, 404);
    return c.json(record);
  });

  return app;
}
