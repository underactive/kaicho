import { SuggestionSchema, type Suggestion } from "../types/index.js";
import { log } from "../logger/index.js";

export interface ParseResult {
  suggestions: Suggestion[];
  rejected: number;
  errors: string[];
}

/**
 * Map common LLM field-name variants to canonical Suggestion field names.
 * Canonical key always wins — aliases only fill in missing fields.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  file: ["fileName", "filepath", "filePath", "path", "filename"],
  line: ["lineNumber", "line_number", "lineNo"],
  category: ["type", "kind"],
  severity: ["level", "priority"],
  rationale: ["description", "reason", "message", "explanation"],
  suggestedChange: ["suggested_change", "fix", "recommendation", "suggestion", "suggestedFix", "suggested_fix"],
};

function normalizeSuggestionFields(obj: Record<string, unknown>): Record<string, unknown> {
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    if (canonical in obj) continue;
    for (const alias of aliases) {
      if (alias in obj) {
        obj[canonical] = obj[alias];
        delete obj[alias];
        break;
      }
    }
  }

  // Coerce line from string to number
  if (typeof obj["line"] === "string") {
    const trimmed = obj["line"].trim();
    if (trimmed === "" || trimmed === "null") {
      obj["line"] = null;
    } else {
      const num = Number(trimmed);
      if (Number.isFinite(num)) obj["line"] = num;
    }
  }

  return obj;
}

/**
 * Validate an array of raw suggestion objects individually.
 * Normalizes field names before validation so minor LLM drift
 * (e.g., "fileName" instead of "file") is corrected, not rejected.
 */
function validateSuggestions(raw: unknown[]): ParseResult {
  const suggestions: Suggestion[] = [];
  const errors: string[] = [];
  let rejected = 0;

  for (const item of raw) {
    const normalized = typeof item === "object" && item !== null
      ? normalizeSuggestionFields(item as Record<string, unknown>)
      : item;
    const result = SuggestionSchema.safeParse(normalized);
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
 * Parse suggestions from freeform text that may contain JSON.
 * Used by all agent adapters (Claude, Codex, Cursor, Gemini).
 * Tries: direct JSON.parse, markdown code fences, brace/bracket extraction.
 */
export function parseFromText(text: string): ParseResult {
  if (!text.trim()) {
    return { suggestions: [], rejected: 0, errors: ["Empty text response"] };
  }

  // Try direct JSON.parse first (agent returned pure JSON)
  try {
    const parsed = JSON.parse(text);
    const raw = extractSuggestionsArray(parsed);
    if (raw) return validateSuggestions(raw);
  } catch {
    // Not pure JSON, try extraction
  }

  // Try extracting from markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      const raw = extractSuggestionsArray(parsed);
      if (raw) return validateSuggestions(raw);
    } catch {
      // Fenced content isn't valid JSON
    }
  }

  // Try finding the outermost JSON object or array in the text
  const jsonStr = extractOutermostJson(text);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      const raw = extractSuggestionsArray(parsed);
      if (raw) return validateSuggestions(raw);
    } catch {
      // Extracted text isn't valid JSON
    }
  }

  return { suggestions: [], rejected: 0, errors: ["No JSON found in text response"] };
}

/**
 * Find the outermost `{...}` or `[...]` in a string by tracking brace depth.
 * Returns the matched substring or null.
 */
function extractOutermostJson(text: string): string | null {
  // Find whichever opener comes first in the text
  const braceIdx = text.indexOf("{");
  const bracketIdx = text.indexOf("[");
  const candidates: Array<[string, string]> = [];
  if (braceIdx !== -1 && bracketIdx !== -1) {
    candidates.push(
      bracketIdx < braceIdx ? ["[", "]"] : ["{", "}"],
      bracketIdx < braceIdx ? ["{", "}"] : ["[", "]"],
    );
  } else if (braceIdx !== -1) {
    candidates.push(["{", "}"]);
  } else if (bracketIdx !== -1) {
    candidates.push(["[", "]"]);
  }

  for (const [openChar, closeChar] of candidates) {
    const startIdx = text.indexOf(openChar);
    if (startIdx === -1) continue;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];

      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === openChar) depth++;
      if (ch === closeChar) depth--;

      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }

  return null;
}

/**
 * Extract a suggestions array from various response shapes:
 * - `[...]` (bare array)
 * - `{ suggestions: [...] }` (canonical wrapper)
 * - `{ findings|results|issues|items: [...] }` (LLM drift fallbacks)
 */
const SUGGESTIONS_KEYS = ["suggestions", "findings", "results", "issues", "items"];

function extractSuggestionsArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    for (const key of SUGGESTIONS_KEYS) {
      if (Array.isArray(obj[key])) {
        return obj[key];
      }
    }
  }

  return null;
}
