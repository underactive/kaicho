import { buildPromptPrelude, ANALYSIS_METHODOLOGY, confidenceGate, OUTPUT_INSTRUCTION } from "./shared.js";

const EXCLUSIONS = `
DO NOT FLAG the following — these are common false positives in contract scans:
- Internal interfaces between modules within the same process that are behind a validated boundary
- Generated types from protobuf, GraphQL codegen, or OpenAPI — the generator enforces the contract
- Loose typing in test fixtures or mock data
- Optional fields handled with defaults — this is standard defensive coding, not a contract violation
- Version-pinned API calls where the caller explicitly targets a known schema version
`;

export function buildContractsScanPrompt(fileManifest?: string, repoContext?: string): string {
  return `You are reviewing a codebase for interface contract violations — bugs and vulnerabilities that emerge at the boundary between components, services, protocols, or APIs.${buildPromptPrelude(fileManifest, repoContext)}
${ANALYSIS_METHODOLOGY}
Focus on:
- Data shape mismatches — caller assumptions that diverge from actual API/protocol schema, missing fields treated as present, incorrect type coercion or endianness, struct packing assumptions that differ from wire format
- Error handling — no distinction between recoverable and fatal errors, swallowed failures, missing retry/backoff on transient faults, no timeout or watchdog configuration, error codes silently mapped to success
- Auth / privilege flows — credential or token lifecycle issues, missing permission checks, race conditions during handshake or session refresh, token expiry not handled, stale auth state after logout
- Data consistency — optimistic state updates without rollback on failure, stale cache served after mutation, sequence counters or cursors not invalidated after writes, torn reads across related resources

Use existing categories for findings:
- "security" for auth/privilege and data exposure issues
- "bug" for data shape mismatches and error handling gaps
- "performance" for missing timeouts and unbounded retries
- "maintainability" for fragile coupling and implicit contracts
${confidenceGate()}
${EXCLUSIONS}
${OUTPUT_INSTRUCTION}`;
}
