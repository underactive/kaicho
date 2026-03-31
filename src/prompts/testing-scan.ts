import { buildPromptPrelude, ANALYSIS_METHODOLOGY, confidenceGate, OUTPUT_INSTRUCTION } from "./shared.js";

const EXCLUSIONS = `
DO NOT FLAG the following — these are common false positives in testing scans:
- Generated code, config files, or build scripts that do not need unit tests
- Trivial functions (getters, setters, simple type mappings) with obvious behavior
- Third-party wrapper functions that merely re-export an external API
- Missing unit tests for code already covered by integration or end-to-end tests at a higher level
- Test files flagged for not testing themselves
`;

export function buildTestingScanPrompt(fileManifest?: string, repoContext?: string): string {
  return `You are reviewing a codebase for testing coverage and test quality issues — gaps where bugs can hide due to missing, weak, or unreliable tests.${buildPromptPrelude(fileManifest, repoContext)}
${ANALYSIS_METHODOLOGY}
Focus on:
- Missing tests — new public functions/modules without corresponding unit tests, modified branching logic without updated assertions, deleted tests not replaced, error paths with no test coverage
- Test quality — assertions on implementation details instead of behavior, tests coupled to internal structure, mocked so heavily the test proves nothing, tests that pass regardless of the code under test
- Integration gaps — cross-module flows tested only with mocks and never with integration or contract tests, initialization/shutdown sequences untested, error injection paths uncovered, boundary interactions between layers never exercised end-to-end
- Flakiness risks — tests dependent on timing or sleep, shared mutable state between test cases, non-deterministic data (random IDs, timestamps), hardware-dependent tests without abstraction layer, port or file path collisions in parallel test runs

Use existing categories for findings:
- "bug" for missing tests on critical paths where bugs are likely hiding
- "maintainability" for test quality issues and coupling to internals
- "documentation" for undocumented test expectations or missing test plan
- "style" for test organization and naming issues
${confidenceGate()}
${EXCLUSIONS}
${OUTPUT_INSTRUCTION}`;
}
