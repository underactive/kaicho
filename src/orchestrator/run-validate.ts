import * as os from "node:os";
import * as path from "node:path";
import type { AgentAdapter } from "../types/index.js";
import {
  ClaudeAdapter,
  CodexAdapter,
  CursorAdapter,
  GeminiAdapter,
} from "../agent-adapters/index.js";
import { AGENT_CONFIGS } from "../config/index.js";
import type { SuggestionCluster } from "../dedup/index.js";
import { buildValidationPrompt, pickReviewer, type ValidationResult } from "../prompts/validate.js";
import { parseFromText } from "../output-parser/index.js";
import { log } from "../logger/index.js";

export interface ValidateOptions {
  repoPath: string;
  cluster: SuggestionCluster;
  diff: string;
  fixAgent: string;
  timeoutMs?: number;
  models?: Record<string, string>;
  reviewer?: string;
}

export interface ValidateResult {
  reviewer: string;
  verdict: "approve" | "concern" | "error" | "skipped";
  rationale: string;
  durationMs: number;
}

const ALL_AGENT_NAMES = Object.keys(AGENT_CONFIGS);

function resolveAdapter(agent: string, timeoutMs?: number, model?: string): AgentAdapter {
  const opts: Partial<import("../types/index.js").AgentConfig> = {};
  if (timeoutMs) opts.timeoutMs = timeoutMs;
  if (model) opts.model = model;
  const hasOpts = Object.keys(opts).length > 0 ? opts : undefined;

  switch (agent) {
    case "claude":
      return new ClaudeAdapter(hasOpts);
    case "codex":
      return new CodexAdapter(hasOpts);
    case "cursor":
      return new CursorAdapter(hasOpts);
    case "gemini":
      return new GeminiAdapter(hasOpts);
    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
}

export async function runValidation(options: ValidateOptions): Promise<ValidateResult> {
  const { cluster, diff, fixAgent, timeoutMs } = options;
  const expanded = options.repoPath.startsWith("~")
    ? path.join(os.homedir(), options.repoPath.slice(1))
    : options.repoPath;
  const absRepoPath = path.resolve(expanded);
  const startMs = Date.now();

  // Pick reviewer: explicit override > auto-pick
  const reviewerName = options.reviewer ?? pickReviewer(fixAgent, cluster.agents, ALL_AGENT_NAMES);
  if (!reviewerName) {
    return {
      reviewer: "none",
      verdict: "skipped",
      rationale: "Only one agent available — cannot cross-validate",
      durationMs: 0,
    };
  }

  const adapter = resolveAdapter(reviewerName, timeoutMs, options.models?.[reviewerName]);

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

    const fallbackAdapter = resolveAdapter(fallback, timeoutMs, options.models?.[fallback]);
    const fallbackAvailable = await fallbackAdapter.isAvailable();
    if (!fallbackAvailable) {
      return {
        reviewer: reviewerName,
        verdict: "skipped",
        rationale: "No reviewer agents available",
        durationMs: Date.now() - startMs,
      };
    }

    return executeValidation(fallback, fallbackAdapter, absRepoPath, cluster, diff, startMs);
  }

  return executeValidation(reviewerName, adapter, absRepoPath, cluster, diff, startMs);
}

async function executeValidation(
  reviewerName: string,
  adapter: AgentAdapter,
  repoPath: string,
  cluster: SuggestionCluster,
  diff: string,
  startMs: number,
): Promise<ValidateResult> {
  const prompt = buildValidationPrompt(cluster, diff);
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
function extractVerdict(rawOutput: string): ValidationResult {
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

  // Can't parse — default to concern with the raw text
  return {
    verdict: "concern",
    rationale: "Could not parse reviewer response. Manual review recommended.",
  };
}

function tryParseVerdict(text: string): ValidationResult | null {
  // Try direct JSON parse
  try {
    const obj = JSON.parse(text);
    if (isVerdict(obj)) return obj as ValidationResult;
  } catch {
    // Not pure JSON
  }

  // Try extracting from markdown fences or embedded JSON
  const match = text.match(/\{[\s\S]*?"verdict"[\s\S]*?"rationale"[\s\S]*?\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (isVerdict(obj)) return obj as ValidationResult;
    } catch {
      // Invalid JSON in match
    }
  }

  return null;
}

function isVerdict(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    (o["verdict"] === "approve" || o["verdict"] === "concern") &&
    typeof o["rationale"] === "string"
  );
}
