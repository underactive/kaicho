import { scopeBlock, OUTPUT_INSTRUCTION } from "./shared.js";

export function buildQaScanPrompt(fileManifest?: string): string {
  return `You are a senior code reviewer performing a quality audit of a codebase. Analyze the code in this repository for quality issues.${scopeBlock(fileManifest)}

Focus on:
- Bugs and logic errors (off-by-one, null derefs, race conditions)
- Dead code and unreachable branches
- Missing or inadequate error handling
- Type safety issues (unsafe casts, missing null checks)
- Test gaps (untested critical paths, missing edge cases)
- Performance problems (N+1 queries, unnecessary allocations, blocking I/O)
- Code duplication that should be refactored
- API misuse or deprecated patterns
- Missing input validation at system boundaries
- Resource leaks (unclosed handles, missing cleanup)
${OUTPUT_INSTRUCTION}`;
}
