import type { RunResult } from "../../types/index.js";
import type { MultiScanResult } from "../../orchestrator/index.js";

function formatSingleResult(result: RunResult): Record<string, unknown> {
  return {
    agent: result.agent,
    status: result.status,
    suggestions: result.suggestions,
    suggestionCount: result.suggestions.length,
    durationMs: result.durationMs,
    startedAt: result.startedAt,
    error: result.error,
  };
}

export function formatJson(result: RunResult): void {
  process.stdout.write(JSON.stringify(formatSingleResult(result), null, 2) + "\n");
}

export function formatMultiJson(multi: MultiScanResult): void {
  const output = {
    results: multi.results.map(formatSingleResult),
    totalSuggestions: multi.totalSuggestions,
    totalDurationMs: multi.totalDurationMs,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
