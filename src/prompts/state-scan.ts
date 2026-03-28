import { scopeBlock, OUTPUT_INSTRUCTION } from "./shared.js";

export function buildStateScanPrompt(fileManifest?: string): string {
  return `You are reviewing a codebase for state management issues — bugs and design problems that arise from how application state is created, modified, observed, and shared.${scopeBlock(fileManifest)}

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

${OUTPUT_INSTRUCTION}`;
}
