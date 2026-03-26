import { scopeBlock, OUTPUT_INSTRUCTION } from "./shared.js";

export function buildDocsScanPrompt(fileManifest?: string): string {
  return `You are a documentation auditor reviewing a codebase. Analyze the code in this repository for documentation gaps and issues.${scopeBlock(fileManifest)}

Focus on:
- Exported functions, classes, and interfaces missing documentation
- Public APIs with no usage examples or parameter descriptions
- Stale or misleading comments that contradict the code
- Missing README or incomplete setup instructions
- Undocumented environment variables, config options, or CLI flags
- Missing changelog entries for recent changes
- Complex logic with no explanatory comments
- Missing license or attribution information
- Undocumented error codes, exit codes, or failure modes
- Missing architecture or design docs for non-obvious patterns
${OUTPUT_INSTRUCTION}`;
}
