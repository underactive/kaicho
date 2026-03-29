import { buildPromptPrelude, OUTPUT_INSTRUCTION } from "./shared.js";

export function buildSecurityScanPrompt(fileManifest?: string, repoContext?: string): string {
  return `You are a security auditor reviewing a codebase. Analyze the code in this repository for security vulnerabilities.${buildPromptPrelude(fileManifest, repoContext)}

Focus on (skip items that aren't relevant to the language):
- Injection & input trust — unsanitized external input used in SQL queries, OS commands, file paths (path traversal), or output rendering (XSS); format-string vulnerabilities; template injection; untrusted data driving control flow (dynamic eval, reflection from user input)
- Authentication & authorization flaws — missing or broken authn/authz checks, privilege escalation, insecure session management, broken access control on endpoints, IDOR, missing CSRF protections, overly permissive CORS or token scoping
- Sensitive data exposure — hardcoded secrets, credentials or API keys in source, secrets logged or leaked in error messages, sensitive data transmitted without TLS or stored without encryption at rest, insufficient redaction in observability pipelines
- Insecure dependencies & configuration — known-vulnerable third-party packages, outdated libraries, overly permissive default configs, debug modes left enabled in production, unnecessary open ports or services, missing security headers
- Missing or insufficient input validation — lack of type, range, length, or format checks on all external input (API payloads, file uploads, headers, query params), unchecked size parameters, inputs that bypass allow-lists via encoding tricks
- Overflows & numeric safety — unbounded buffer writes, unguarded index/array access, integer overflow/underflow in arithmetic (especially size calculations and loop bounds), unchecked casts between numeric types
- Memory & resource leaks — allocated resources not freed on all exit paths including error branches, event listeners or interrupt handlers not deregistered on cleanup, growing caches/buffers without eviction or bounds, file handle and connection pool exhaustion
- Unsafe deserialization — deserializing untrusted data without type constraints (pickle, YAML load, Java ObjectInputStream, JSON-to-object mappers with polymorphic type handling), any pattern where attacker-controlled bytes become live objects
- Insecure cryptographic practices — use of broken or weak algorithms (MD5, SHA-1 for security purposes, ECB mode), hardcoded IVs or salts, insufficient key lengths, rolling your own crypto, improper random number generation (Math.random for tokens)
- Hard crashes & unhandled failures — null/undefined dereferences without guards, unhandled exceptions in async or interrupt contexts, uncaught error propagation across module boundaries, panics in library code that callers can't recover from, missing fallback logic in critical paths
${OUTPUT_INSTRUCTION}`;
}
