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

/**
 * Uses `.nullable()` instead of `.optional()` so the zod schema aligns with
 * OpenAI's strict JSON Schema requirement where every property must appear in
 * `required` and optional values use `type: ["T", "null"]`.
 */
export const SuggestionSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().nullable(),
  category: CategoryEnum,
  severity: SeverityEnum,
  rationale: z.string().min(1),
  suggestedChange: z.string().nullable(),
});

export type Suggestion = z.infer<typeof SuggestionSchema>;
