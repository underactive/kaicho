import type { Suggestion, RunResult } from "../../types/index.js";

const NO_COLOR = "NO_COLOR" in process.env;

const SEVERITY_COLORS: Record<string, string> = {
  critical: "\x1b[91m", // bright red
  high: "\x1b[31m",     // red
  medium: "\x1b[33m",   // yellow
  low: "\x1b[36m",      // cyan
  info: "\x1b[90m",     // gray
};

const RESET = "\x1b[0m";

function color(text: string, code: string): string {
  if (NO_COLOR) return text;
  return `${code}${text}${RESET}`;
}

function severityLabel(severity: string): string {
  const code = SEVERITY_COLORS[severity] ?? "";
  return color(`[${severity}]`, code);
}

function formatSuggestion(s: Suggestion): string {
  const location = s.line ? `${s.file}:${s.line}` : s.file;
  const header = `  ${severityLabel(s.severity)} ${s.category} — ${location}`;
  const rationale = `    ${truncate(s.rationale, 100)}`;

  const lines = [header, rationale];
  if (s.suggestedChange) {
    lines.push(`    ▸ ${truncate(s.suggestedChange, 100)}`);
  }

  return lines.join("\n");
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, " ");
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 1) + "…";
}

interface FormatOptions {
  verbose?: boolean;
  debug?: boolean;
}

export function formatHuman(result: RunResult, options: FormatOptions = {}): void {
  const out = process.stdout;

  if (result.status !== "success") {
    out.write(
      color(`\n  Error: ${result.error ?? result.status}\n\n`, "\x1b[31m"),
    );
    if (options.debug && result.rawError) {
      out.write(`  stderr: ${result.rawError.slice(0, 500)}\n\n`);
    }
    return;
  }

  const count = result.suggestions.length;
  const duration = (result.durationMs / 1000).toFixed(1);

  if (count === 0) {
    out.write(`\n  No suggestions from ${result.agent} (${duration}s)\n\n`);
    return;
  }

  // Group by file, sort by severity within each file
  const grouped = groupByFile(result.suggestions);

  out.write("\n");
  for (const [file, suggestions] of grouped) {
    out.write(color(`  ${file}\n`, "\x1b[1m")); // bold
    for (const s of sortBySeverity(suggestions)) {
      out.write(formatSuggestion(s) + "\n");
    }
    out.write("\n");
  }

  out.write(`  ${count} suggestion${count === 1 ? "" : "s"} from ${result.agent} (${duration}s)\n\n`);

  if (options.debug && result.rawOutput) {
    out.write("  --- raw output ---\n");
    out.write(result.rawOutput.slice(0, 2000) + "\n");
  }
}

function groupByFile(suggestions: Suggestion[]): Map<string, Suggestion[]> {
  const map = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const existing = map.get(s.file);
    if (existing) {
      existing.push(s);
    } else {
      map.set(s.file, [s]);
    }
  }
  return map;
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function sortBySeverity(suggestions: Suggestion[]): Suggestion[] {
  return [...suggestions].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5),
  );
}
