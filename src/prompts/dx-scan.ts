import { scopeBlock, OUTPUT_INSTRUCTION } from "./shared.js";

export function buildDxScanPrompt(fileManifest?: string): string {
  return `You are reviewing a codebase for developer experience and maintainability issues — problems that slow down future development, obscure intent, or accumulate technical debt.${scopeBlock(fileManifest)}

Focus on:
- Readability — functions exceeding ~50 lines, boolean parameters without named constants, magic numbers/strings without explanation, nested ternaries or conditionals deeper than one level, complex expressions that should be extracted to named variables
- Dead code — unused includes/imports, unreachable branches behind stale feature flags, commented-out blocks with no context, exported symbols with zero consumers, parameters accepted but never read
- Naming & structure — inconsistent naming conventions, business/domain logic buried in UI or driver layers, utility functions duplicated across modules, abstraction levels mixed within a single function
- Documentation — public API changes without updated doc comments, non-obvious workarounds missing a "WHY" comment, breaking changes without migration notes, complex algorithms without high-level explanation

Use existing categories for findings:
- "maintainability" for readability, naming, structure, and dead code issues
- "documentation" for missing or outdated doc comments and migration notes
- "style" for naming convention inconsistencies and formatting
- "bug" for dead code that masks actual bugs (unreachable error handlers, etc.)

${OUTPUT_INSTRUCTION}`;
}
