import { buildPromptPrelude, ANALYSIS_METHODOLOGY, confidenceGate, OUTPUT_INSTRUCTION } from "./shared.js";

const EXCLUSIONS = `
DO NOT FLAG the following — these are common false positives in performance scans:
- One-shot scripts, CLI tools, or build-time code where execution speed is irrelevant
- Application startup/initialization code that runs once per process lifetime
- Readability-first patterns in non-hot paths (e.g., array spread vs manual loop in code called once)
- Small fixed-size collections iterated with O(n²) where n is bounded and small (< 100 items)
- Missing caching for data that changes on every request or has no reuse window
- Bundle size concerns in server-only code that is never sent to clients
`;

export function buildPerformanceScanPrompt(fileManifest?: string, repoContext?: string): string {
  return `You are a performance engineer reviewing a codebase for efficiency issues — problems that cause unnecessary latency, memory consumption, or resource waste under real-world workloads.${buildPromptPrelude(fileManifest, repoContext)}
${ANALYSIS_METHODOLOGY}
Focus on (skip items that aren't relevant to the language or runtime):
- N+1 queries & redundant I/O — database queries inside loops, repeated network calls that could be batched, sequential awaits that could be parallelized, redundant file reads for data already in memory
- Algorithmic complexity — O(n²) or worse over collections that grow with input size, linear scans where an index or map lookup would suffice, repeated full-array searches inside loops, sort-then-search where a heap or priority queue fits
- Blocking the event loop / main thread — synchronous file or network I/O in async contexts, CPU-intensive computation without yielding, long-running loops without chunking or worker offload, JSON.parse/stringify on large payloads in request handlers
- Missing caching — repeated expensive computation with identical inputs, redundant API/database calls for immutable or slowly-changing data, missing HTTP cache headers on static or semi-static responses
- Unnecessary re-renders & missing memoization — components re-rendering on every parent render without memo/useMemo/computed, expensive derived state recomputed on every access, missing key props causing full list re-renders
- Bundle & payload size — heavy dependencies imported for a single utility function, entire libraries imported where a subpath or tree-shakeable import exists, large static assets inlined instead of lazy-loaded
- Unbounded data structures — growing arrays, maps, or caches without eviction or size limits, event history or log buffers that accumulate indefinitely, in-memory queues without backpressure
- Excessive allocation — object creation inside tight loops where reuse is possible, string concatenation in hot paths where a builder or buffer fits, unnecessary copying of large arrays or buffers

Skip items covered by other scan tasks:
- Resource leaks (file handles, sockets) — covered by the "resources" task
- Security-related validation overhead — covered by the "security" task
- Dead code removal — covered by the "dx" task

Use existing categories for findings:
- "performance" for latency, throughput, memory, and bundle size issues
- "bug" for performance issues that also cause incorrect behavior (e.g., infinite growth leading to OOM)
${confidenceGate()}
${EXCLUSIONS}
${OUTPUT_INSTRUCTION}`;
}
