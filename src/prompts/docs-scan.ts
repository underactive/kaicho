import { scopeBlock, OUTPUT_INSTRUCTION } from "./shared.js";

export function buildDocsScanPrompt(fileManifest?: string): string {
  return `You are a documentation auditor reviewing a codebase. Analyze the code in this repository for documentation gaps and issues.${scopeBlock(fileManifest)}

Focus on:
- Exported API documentation — exported functions, classes, and interfaces missing doc comments, public APIs with no usage examples or parameter descriptions, undocumented return types and thrown exceptions
- Stale or misleading comments — comments that contradict current code behavior, outdated TODOs, copy-pasted descriptions that no longer match the function they sit above
- Complex logic without explanation — non-obvious algorithms, regex patterns, bitwise operations, or business rules with no inline comments explaining intent or reasoning
- README & setup instructions — missing or incomplete README, undocumented prerequisites, missing steps to go from clone to running locally, no troubleshooting section for common failures
- Environment variables & configuration — undocumented env vars, config options, CLI flags, or feature flags; missing descriptions of valid values, defaults, and what happens when they're omitted
- Changelog & versioning — missing changelog entries for recent changes, no record of breaking changes, undocumented migration steps between versions
- Error codes & failure modes — undocumented error codes, exit codes, HTTP status meanings, or failure scenarios; no guidance on what the caller should do when something fails
- Architecture & design docs — missing high-level architecture docs for non-obvious patterns, undocumented system boundaries, no explanation of why key design decisions were made
- License & attribution — missing license file, undocumented third-party code or asset usage, missing attribution required by upstream licenses
${OUTPUT_INSTRUCTION}`;
}
