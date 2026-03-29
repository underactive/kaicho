import { buildPromptPrelude, OUTPUT_INSTRUCTION } from "./shared.js";

export function buildResilienceScanPrompt(fileManifest?: string, repoContext?: string): string {
  return `You are a reliability engineer reviewing a codebase for fault tolerance and graceful degradation issues — problems that cause cascading failures, unavailability, or data loss when external dependencies misbehave or load spikes.${buildPromptPrelude(fileManifest, repoContext)}

Focus on (skip items that aren't relevant to the language or deployment model):
- Missing timeouts — HTTP/RPC/database calls without explicit timeout configuration, file or network operations that can hang indefinitely, external service calls that block callers without a deadline
- Missing circuit breakers & fallbacks — calls to external services with no fallback path when the service is down, no circuit breaker pattern to stop retrying a known-failing dependency, missing degraded-mode behavior (e.g., serve stale data, skip non-critical features)
- Unbounded retries — retry loops without maximum attempts, missing exponential backoff or jitter, retry storms that amplify load on an already-struggling dependency
- Missing graceful shutdown — no signal handler for SIGTERM/SIGINT, in-flight requests dropped on shutdown, background workers not drained before exit, database connections not closed on process termination
- Cascading failure paths — one failing dependency taking down unrelated request paths, shared connection/thread pools exhausted by a single slow dependency, missing bulkhead isolation between independent subsystems
- Missing rate limiting — exposed API endpoints without request rate limits, no per-client or per-IP throttling, missing payload size limits allowing oversized requests to consume server resources
- Missing health checks — no liveness or readiness probe endpoints, health checks that don't verify actual dependency connectivity, no distinction between "starting up" and "broken"
- Partial failure handling — all-or-nothing operations where partial success is valid, missing compensation or rollback for multi-step workflows, no idempotency keys on retryable mutations

Skip items covered by other scan tasks:
- Authentication & session lifecycle — covered by the "security" and "contracts" tasks
- Data consistency after failure — covered by the "contracts" and "state" tasks
- Resource leaks & cleanup — covered by the "resources" task

Use existing categories for findings:
- "bug" for missing resilience patterns that cause failures under real conditions
- "security" for missing rate limiting and unbounded input that enables DoS
- "performance" for unbounded retries and missing backoff that amplifies load

${OUTPUT_INSTRUCTION}`;
}
