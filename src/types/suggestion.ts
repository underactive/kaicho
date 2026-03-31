import { z } from "zod";

export const SeverityEnum = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof SeverityEnum>;

export const CategoryEnum = z.enum([
  "security",
  "bug",
  "performance",
  "maintainability",
  "style",
  "documentation",
]);
export type Category = z.infer<typeof CategoryEnum>;

/** Map common agent-invented categories to valid enum values. */
const CATEGORY_ALIASES: Record<string, Category> = {
  race: "bug",
  "race-condition": "bug",
  concurrency: "bug",
  error: "bug",
  "error-handling": "bug",
  reliability: "bug",
  correctness: "bug",
  logic: "bug",
  memory: "performance",
  "memory-leak": "performance",
  optimization: "performance",
  docs: "documentation",
  typing: "maintainability",
  refactor: "maintainability",
  complexity: "maintainability",
  "code-quality": "maintainability",
  formatting: "style",
  naming: "style",
  vulnerability: "security",
  auth: "security",
  injection: "security",
};

function normalizeCategory(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const lower = v.toLowerCase();
  return CATEGORY_ALIASES[lower] ?? lower;
}

/**
 * Uses `.nullable()` instead of `.optional()` so the zod schema aligns with
 * OpenAI's strict JSON Schema requirement where every property must appear in
 * `required` and optional values use `type: ["T", "null"]`.
 */
export const SuggestionSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().nullable(),
  category: z.preprocess(normalizeCategory, CategoryEnum),
  severity: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), SeverityEnum),
  rationale: z.string().min(1),
  suggestedChange: z.string().nullable(),
});

export type Suggestion = z.infer<typeof SuggestionSchema>;
