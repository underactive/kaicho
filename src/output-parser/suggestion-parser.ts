import { SuggestionSchema, type Suggestion } from "../types/index.js";
import { log } from "../logger/index.js";

export interface ParseResult {
  suggestions: Suggestion[];
  rejected: number;
  errors: string[];
}

/**
 * Validate an array of raw suggestion objects individually.
 * Keeps valid items, logs and counts rejected ones.
 */
function validateSuggestions(raw: unknown[]): ParseResult {
  const suggestions: Suggestion[] = [];
  const errors: string[] = [];
  let rejected = 0;

  for (const item of raw) {
    const result = SuggestionSchema.safeParse(item);
    if (result.success) {
      suggestions.push(result.data);
    } else {
      rejected++;
      const msg = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      errors.push(msg);
      log("warn", "Rejected suggestion", {
        keys: typeof item === "object" && item !== null ? Object.keys(item) : typeof item,
        validation: msg,
      });
    }
  }

  return { suggestions, rejected, errors };
}

/**
 * Primary path: parse from the `-o` output file content.
 * Expects JSON like `{"suggestions": [...]}` or just `[...]`.
 */
export function parseFromFile(content: string): ParseResult {
  if (!content.trim()) {
    return { suggestions: [], rejected: 0, errors: ["Empty output file"] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { suggestions: [], rejected: 0, errors: ["Invalid JSON in output file"] };
  }

  const raw = extractSuggestionsArray(parsed);
  if (!raw) {
    return { suggestions: [], rejected: 0, errors: ["No suggestions array found in output"] };
  }

  return validateSuggestions(raw);
}

/**
 * Fallback path: parse from Codex JSONL event stream.
 * Looks for `item.completed` events with agent messages.
 */
export function parseFromJsonl(stdout: string): ParseResult {
  if (!stdout.trim()) {
    return { suggestions: [], rejected: 0, errors: ["Empty JSONL stream"] };
  }

  const lines = stdout.trim().split("\n");
  const errors: string[] = [];

  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // skip non-JSON lines
    }

    if (event["type"] !== "item.completed") continue;

    const item = event["item"] as Record<string, unknown> | undefined;
    if (!item || typeof item["text"] !== "string") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(item["text"]);
    } catch {
      errors.push("Failed to parse item.text as JSON");
      continue;
    }

    const raw = extractSuggestionsArray(parsed);
    if (raw) {
      return validateSuggestions(raw);
    }
  }

  return { suggestions: [], rejected: 0, errors: [...errors, "No suggestions found in JSONL stream"] };
}

/**
 * Extract a suggestions array from various response shapes:
 * - `{ suggestions: [...] }`
 * - `[...]` (bare array)
 */
function extractSuggestionsArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "suggestions" in parsed
  ) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj["suggestions"])) {
      return obj["suggestions"];
    }
  }

  return null;
}
