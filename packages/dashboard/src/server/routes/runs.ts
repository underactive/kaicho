import { Hono } from "hono";
import type Database from "better-sqlite3";
import { readRunRecords, readRunRecord } from "../readers/run-reader.js";

export function runRoutes(db: Database.Database): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const task = c.req.query("task");
    const agent = c.req.query("agent");
    const records = readRunRecords(db, {
      task: task || undefined,
      agent: agent || undefined,
    });
    return c.json(records);
  });

  app.get("/:runId", (c) => {
    const record = readRunRecord(db, c.req.param("runId"));
    if (!record) return c.json({ error: "Not found" }, 404);
    return c.json(record);
  });

  return app;
}
