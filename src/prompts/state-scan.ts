import { buildPromptPrelude, ANALYSIS_METHODOLOGY, confidenceGate, OUTPUT_INSTRUCTION } from "./shared.js";

const EXCLUSIONS = `
DO NOT FLAG the following — these are common false positives in state management scans:
- Intentional direct mutation in libraries designed for it (Redux Toolkit with Immer, MobX, Zustand with mutative middleware)
- Framework-managed state used according to framework conventions (React useState, Vue reactive/ref, Svelte stores)
- Module-level singletons in server-side code where the process model guarantees single-threaded access
- Local mutable variables that never escape their function scope
- Builder or accumulator patterns that mutate a local object before returning it
`;

export function buildStateScanPrompt(fileManifest?: string, repoContext?: string): string {
  return `You are reviewing a codebase for state management issues — bugs and design problems that arise from how application state is created, modified, observed, and shared.${buildPromptPrelude(fileManifest, repoContext)}
${ANALYSIS_METHODOLOGY}
Focus on:
- Mutation discipline — shared state modified outside designated update paths, state transitions that skip validation, side effects hidden inside getters or read operations, direct mutation of state that should be immutable or copy-on-write
- Reactivity / observation pitfalls — mutable updates that bypass change detection or notification mechanisms, deeply nested state triggering unnecessary cascading updates, stale closures capturing outdated state references
- Data flow — excessive pass-through of context across layers where a shared store or service belongs, sibling modules communicating via parent state mutation, event/signal spaghetti without cleanup, circular dependencies between state producers and consumers
- Sync issues — local copies shadowing canonical state, multiple sources of truth for the same entity, concurrent writers without arbitration (locks, atomics, or message ordering), async operations completing after state has moved on

Use existing categories for findings:
- "bug" for mutation violations and sync issues that cause incorrect behavior
- "maintainability" for data flow problems and tangled state dependencies
- "performance" for unnecessary cascading updates and observation overhead
- "security" for state tampering or privilege escalation via unguarded mutation
${confidenceGate()}
${EXCLUSIONS}
${OUTPUT_INSTRUCTION}`;
}
