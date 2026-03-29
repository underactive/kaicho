import { buildPromptPrelude, OUTPUT_INSTRUCTION } from "./shared.js";

export function buildResourcesScanPrompt(fileManifest?: string, repoContext?: string): string {
  return `You are reviewing a codebase for resource management and concurrency issues — bugs that emerge from shared resources, parallel execution, timing assumptions, and hardware lifecycle.${buildPromptPrelude(fileManifest, repoContext)}

Focus on:
- Concurrency — data races on shared memory, missing locks/mutexes/atomics around critical sections, deadlock potential from lock ordering, priority inversion in RTOS or threaded contexts, non-atomic read-modify-write sequences on shared state
- Resource lifecycle — file handles, sockets, DMA channels, or peripherals not released on error paths; double-free or use-after-free; resource exhaustion under sustained load; missing cleanup in interrupt or exception handlers
- Timing — assumptions about execution order without synchronization, spin-waits without yield or timeout, interrupt latency not accounted for in real-time constraints, unbounded blocking in time-critical paths
- Power & hardware — peripherals left in active state after use, missing clock gating or sleep transitions, watchdog not fed on long operations, register access without volatile or memory barriers, bus contention from concurrent peripheral access

Use existing categories for findings:
- "bug" for races, double-free, use-after-free, and resource leaks
- "security" for exploitable race conditions and unguarded memory access
- "performance" for spin-waits, missing sleep transitions, and resource exhaustion
- "maintainability" for implicit timing assumptions and fragile lock ordering

${OUTPUT_INSTRUCTION}`;
}
