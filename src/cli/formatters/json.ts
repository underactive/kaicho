import type { RunResult } from "../../types/index.js";

export function formatJson(result: RunResult): void {
  const output = {
    agent: result.agent,
    status: result.status,
    suggestions: result.suggestions,
    suggestionCount: result.suggestions.length,
    durationMs: result.durationMs,
    startedAt: result.startedAt,
    error: result.error,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
