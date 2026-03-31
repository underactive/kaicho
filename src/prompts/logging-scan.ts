import { buildPromptPrelude, ANALYSIS_METHODOLOGY, confidenceGate, OUTPUT_INSTRUCTION } from "./shared.js";

const EXCLUSIONS = `
DO NOT FLAG the following — these are common false positives in logging scans:
- CLI tools that use stdout/stderr as their interface — console.log IS the output mechanism, not a logging gap
- Development-only debug logging behind NODE_ENV, DEBUG, or similar feature flags
- Test code using console.log for test output or debugging
- Structured logging libraries that already handle level and context internally (winston, pino, bunyan, slog) — do not re-flag what the library provides
- Log messages in catch blocks that include the error object — this IS including context
- Request IDs, timestamps, HTTP methods, and status codes in logs — these are not sensitive data
`;

export function buildLoggingScanPrompt(fileManifest?: string, repoContext?: string): string {
  return `You are a logging and observability auditor reviewing a codebase for issues that affect debugging, monitoring, security audit trails, and data leak risk through log output.${buildPromptPrelude(fileManifest, repoContext)}
${ANALYSIS_METHODOLOGY}
Focus on (skip items that aren't relevant to the language or logging framework):
- Sensitive data in logs — PII (names, emails, phone numbers), authentication tokens, passwords, API keys, session IDs, or credit card numbers written to log output; missing redaction in structured log fields; sensitive data in error messages exposed to callers
- Bare console.log / print — unstructured log statements instead of a leveled logging framework, debug print statements left in production code paths, log output that cannot be parsed by log aggregation tools
- Inconsistent log levels — debug-level messages on production request paths, info-level for actual errors, warn/error for non-actionable conditions, missing severity distinction between transient and fatal failures
- Missing request context — log entries without request ID, correlation ID, or trace ID; inability to follow a single request across multiple log lines or services; missing user/tenant context on security-relevant actions
- Log injection — unsanitized user input interpolated directly into log messages, allowing log forging, CRLF injection, or log parsing confusion; format string vulnerabilities in logging calls
- Missing error context — catch blocks that log a generic message without the original error, stack traces discarded or truncated, missing contextual data (which input, which user, which endpoint) alongside the error
- Excessive logging in hot paths — logging inside tight loops or per-item processing without rate limiting, large object serialization on every request, verbose logging enabled by default in performance-sensitive paths
- Missing audit trail — security-relevant actions (login, logout, permission changes, data access, admin operations) not logged, missing "who did what when" for compliance-sensitive workflows, no distinction between system actions and user-initiated actions

Skip items covered by other scan tasks:
- Hardcoded secrets in source code — covered by the "security" task
- Missing documentation of error codes — covered by the "docs" task
- Error handling correctness (try/catch structure) — covered by the "qa" task

Use existing categories for findings:
- "security" for sensitive data leaks, log injection, and missing audit trails
- "maintainability" for unstructured logging, inconsistent levels, and missing context
- "bug" for swallowed error context that hides real failures
${confidenceGate()}
${EXCLUSIONS}
${OUTPUT_INSTRUCTION}`;
}
