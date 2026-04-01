export function scopeBlock(fileManifest?: string): string {
  if (!fileManifest) return "";
  return `\n\nSCOPE: Only review the following files. Do not review files outside this list.\n${fileManifest}\n`;
}

/**
 * Compose repo context + file scope into a single prompt prelude block.
 * Future prompt enrichment (git activity, custom context) should be added here
 * so that individual prompt builders don't need signature changes.
 */
export function buildPromptPrelude(fileManifest?: string, repoContext?: string): string {
  let prelude = "\n\nCRITICAL: You MUST respond with ONLY a JSON object. No prose, no markdown, no explanation outside the JSON.";
  if (repoContext) prelude += `\n\n${repoContext}`;
  if (fileManifest) prelude += `\n\nSCOPE: Only review the following files. Do not review files outside this list.\n${fileManifest}\n`;
  return prelude;
}

export const ANALYSIS_METHODOLOGY = `
ANALYSIS METHODOLOGY — Follow these phases in order:
1. Understand context: Before flagging anything, study the repository's existing patterns, frameworks, conventions, and architectural decisions. Use the repo context above and examine the code structure.
2. Compare against established patterns: Evaluate code against the project's OWN conventions and industry standards for its stack — not your personal preferences or theoretical ideals.
3. Assess real-world impact: For each potential finding, ask "Would a senior developer on this project consider this a real problem worth fixing?" Discard anything speculative, cosmetic, or with negligible practical impact.
`;

export function confidenceGate(threshold = 75): string {
  return `\nCONFIDENCE GATE: Only report findings where you are at least ${threshold}% confident the issue is real, impactful, and not an intentional design choice. When in doubt, omit the finding.\n`;
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
