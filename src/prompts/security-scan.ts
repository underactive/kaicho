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

export function buildSecurityScanPrompt(): string {
  return `You are a security auditor reviewing a codebase. Analyze the code in this repository for security vulnerabilities.

Focus on:
- Injection vulnerabilities (SQL, command, path traversal)
- Authentication and authorization flaws
- Sensitive data exposure (hardcoded secrets, credentials in code)
- Insecure dependencies or configurations
- Missing input validation
- Unsafe deserialization
- Cross-site scripting (XSS) in any web code
- Insecure cryptographic practices

For each finding, provide:
- file: the relative file path from the repository root
- line: the line number (if applicable, otherwise null)
- category: one of "security", "bug", "performance", "maintainability", "style", "documentation"
- severity: one of "critical", "high", "medium", "low", "info"
- rationale: a clear explanation of the vulnerability and its impact
- suggestedChange: a concrete fix or mitigation (if applicable, otherwise null)

Be specific. Reference actual code. Do not invent files that do not exist.
If you find no security issues, return an empty suggestions array.`;
}
