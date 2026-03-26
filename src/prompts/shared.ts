/**
 * OpenAI-strict JSON Schema for the suggestions output.
 *
 * Requirements for Codex --output-schema:
 * - `additionalProperties: false` at every object level
 * - All properties listed in `required`
 * - Optional values use `type: ["T", "null"]`
 */
export const SUGGESTIONS_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    suggestions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          file: { type: "string" as const },
          line: { type: ["number", "null"] as const },
          category: {
            type: "string" as const,
            enum: [
              "security",
              "bug",
              "performance",
              "maintainability",
              "style",
              "documentation",
            ],
          },
          severity: {
            type: "string" as const,
            enum: ["critical", "high", "medium", "low", "info"],
          },
          rationale: { type: "string" as const },
          suggestedChange: { type: ["string", "null"] as const },
        },
        required: [
          "file",
          "line",
          "category",
          "severity",
          "rationale",
          "suggestedChange",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

export function scopeBlock(fileManifest?: string): string {
  if (!fileManifest) return "";
  return `\n\nSCOPE: Only review the following files. Do not review files outside this list.\n${fileManifest}\n`;
}

export const OUTPUT_INSTRUCTION = `
For each finding, provide:
- file: the relative file path from the repository root
- line: the line number (if applicable, otherwise null)
- category: one of "security", "bug", "performance", "maintainability", "style", "documentation"
- severity: one of "critical", "high", "medium", "low", "info"
- rationale: a clear explanation of the issue and its impact
- suggestedChange: a concrete fix or mitigation (if applicable, otherwise null)

Be specific. Reference actual code. Do not invent files that do not exist.
If you find no issues, return an empty suggestions array.

IMPORTANT: Return your response as a JSON object with this exact structure:
{"suggestions": [{"file": "...", "line": ..., "category": "...", "severity": "...", "rationale": "...", "suggestedChange": "..."}]}
Return ONLY the JSON object, no other text.`;
