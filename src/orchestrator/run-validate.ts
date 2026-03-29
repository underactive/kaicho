import * as os from "node:os";
import * as path from "node:path";
import type { AgentAdapter } from "../types/index.js";
import type { SuggestionCluster } from "../dedup/index.js";
import { buildValidationPrompt, pickReviewer, type ValidationResult } from "../prompts/validate.js";
import { resolveAdapter, ALL_AGENT_NAMES } from "./resolve-adapter.js";
import { resolveModel } from "../config/index.js";
import { log } from "../logger/index.js";

export interface ValidateOptions {
  repoPath: string;
  cluster: SuggestionCluster;
  diff: string;
  fixAgent: string;
  timeoutMs?: number;
  models?: Record<string, string>;
  reviewer?: string;
  verbose?: boolean;
  fixerContext?: string;
  repoContext?: string;
}

export interface ValidateResult {
  reviewer: string;
  verdict: "approve" | "concern" | "error" | "skipped";
  rationale: string;
  durationMs: number;
}

export async function runValidation(options: ValidateOptions): Promise<ValidateResult> {
  const { cluster, diff, fixAgent, timeoutMs } = options;
  const expanded = options.repoPath.startsWith("~")
    ? path.join(os.homedir(), options.repoPath.slice(1))
    : options.repoPath;
  const absRepoPath = path.resolve(expanded);
  const startMs = Date.now();

  // Pick reviewer: explicit override > pool > auto-pick
  let reviewerName: string | null;
  if (options.reviewer?.includes(",")) {
    const pool = options.reviewer.split(",").map((s) => s.trim());
    reviewerName = pickReviewer(fixAgent, cluster.agents, ALL_AGENT_NAMES, pool);
  } else {
    reviewerName = options.reviewer ?? pickReviewer(fixAgent, cluster.agents, ALL_AGENT_NAMES);
  }
  if (!reviewerName) {
    return {
      reviewer: "none",
      verdict: "skipped",
      rationale: "Only one agent available — cannot cross-validate",
      durationMs: 0,
    };
  }

  const adapter = resolveAdapter(reviewerName, timeoutMs, resolveModel(reviewerName, options.models), options.verbose);

  const available = await adapter.isAvailable();
  if (!available) {
    // Try another agent
    const fallback = ALL_AGENT_NAMES.find((a) => a !== fixAgent && a !== reviewerName);
    if (!fallback) {
      return {
        reviewer: reviewerName,
        verdict: "skipped",
        rationale: `Reviewer "${reviewerName}" not installed, no other agents available`,
        durationMs: Date.now() - startMs,
      };
    }

    const fallbackAdapter = resolveAdapter(fallback, timeoutMs, resolveModel(fallback, options.models), options.verbose);
    const fallbackAvailable = await fallbackAdapter.isAvailable();
    if (!fallbackAvailable) {
      return {
        reviewer: reviewerName,
        verdict: "skipped",
        rationale: "No reviewer agents available",
        durationMs: Date.now() - startMs,
      };
    }

    return executeValidation(fallback, fallbackAdapter, absRepoPath, cluster, diff, startMs, options.fixerContext, options.repoContext);
  }

  return executeValidation(reviewerName, adapter, absRepoPath, cluster, diff, startMs, options.fixerContext, options.repoContext);
}

async function executeValidation(
  reviewerName: string,
  adapter: AgentAdapter,
  repoPath: string,
  cluster: SuggestionCluster,
  diff: string,
  startMs: number,
  fixerContext?: string,
  repoContext?: string,
): Promise<ValidateResult> {
  const prompt = buildValidationPrompt(cluster, diff, fixerContext, repoContext);
  log("info", "Running validation", { reviewer: reviewerName, cluster: cluster.id });

  // Use "review" mode: read-only permissions, no schema enforcement.
  // The verdict is parsed from rawOutput by extractVerdict().
  const result = await adapter.run(repoPath, prompt, "review");

  if (result.status !== "success") {
    return {
      reviewer: reviewerName,
      verdict: "error",
      rationale: result.error ?? `Reviewer ${result.status}`,
      durationMs: Date.now() - startMs,
    };
  }

  // Parse verdict from response
  const validation = extractVerdict(result.rawOutput);

  if (!validation) {
    log("warn", "Could not parse reviewer verdict", { reviewer: reviewerName });
    return {
      reviewer: reviewerName,
      verdict: "skipped",
      rationale: "Could not parse reviewer response. Manual review recommended.",
      durationMs: Date.now() - startMs,
    };
  }

  return {
    reviewer: reviewerName,
    verdict: validation.verdict,
    rationale: validation.rationale,
    durationMs: Date.now() - startMs,
  };
}

/**
 * Extract the verdict JSON from the reviewer's response.
 * Handles both schema-enforced (Claude/Codex wrapper) and freeform (Cursor/Gemini) output.
 */
function extractVerdict(rawOutput: string): ValidationResult | null {
  // Try parsing the CLI wrapper first
  try {
    const wrapper = JSON.parse(rawOutput) as Record<string, unknown>;

    // Claude: structured_output or result field
    const structured = wrapper["structured_output"] as Record<string, unknown> | undefined;
    if (structured && isVerdict(structured)) {
      return structured as unknown as ValidationResult;
    }

    const resultText = wrapper["result"] as string | undefined;
    if (resultText) {
      const parsed = tryParseVerdict(resultText);
      if (parsed) return parsed;
    }

    // Gemini: response field
    const response = wrapper["response"] as string | undefined;
    if (response) {
      const parsed = tryParseVerdict(response);
      if (parsed) return parsed;
    }
  } catch {
    // Not a JSON wrapper, try as plain text
  }

  // Fallback: try parsing the entire output as text containing JSON
  const parsed = tryParseVerdict(rawOutput);
  if (parsed) return parsed;

  // Can't parse — return null so the caller can handle as "skipped"
  return null;
}

function tryParseVerdict(text: string): ValidationResult | null {
  // Try direct JSON parse
  try {
    const obj = JSON.parse(text);
    if (isVerdict(obj)) return obj as ValidationResult;
  } catch {
    // Not pure JSON
  }

  // Extract JSON objects using brace-depth matching
  for (const candidate of extractJsonObjects(text)) {
    try {
      const obj = JSON.parse(candidate);
      if (isVerdict(obj)) return obj as ValidationResult;
    } catch {
      // Invalid JSON candidate
    }
  }

  return null;
}

/**
 * Extract top-level JSON objects from text using brace-depth counting.
 * Handles nested braces inside string values correctly.
 */
function extractJsonObjects(text: string): string[] {
  const results: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "{") { i++; continue; }

    let depth = 0;
    let inString = false;
    let escaped = false;
    const start = i;

    for (; i < text.length; i++) {
      const ch = text[i]!;

      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }

      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          results.push(text.slice(start, i + 1));
          i++;
          break;
        }
      }
    }
  }

  return results;
}

function isVerdict(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    (o["verdict"] === "approve" || o["verdict"] === "concern") &&
    typeof o["rationale"] === "string"
  );
}
