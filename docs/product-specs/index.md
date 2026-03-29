# Product Specs Index

Product specs define user-facing behavior and acceptance criteria. Agents
reference these to understand what the product should do, not just how the
code is structured.

## Core user flow

1. User points Kaicho at a target repository
2. Kaicho invokes one or more AI agents against that repo
3. Each agent's raw output is captured and parsed
4. Output is normalized into structured `Suggestion` objects
5. Suggestions are deduplicated, clustered, and enriched with LLM summaries
6. User reviews aggregated findings across agents (report)
7. User dispatches an agent to apply fixes on isolated branches (fix)
8. User reviews diffs and merges when satisfied

## Specs

| Spec | Status | Description |
|------|--------|-------------|
| [scan](scan.md) | Implemented | Multi-agent parallel scanning, 11 task types, dedup and scoping |
| [report](report.md) | Implemented | View and filter past scan results |
| [list](list.md) | Implemented | Show installed agents and versions |
| [config](config.md) | Implemented | Per-repo config file + kaicho init |
| [fix](fix.md) | Implemented (Phase A-D) | Single + parallel worktree batch fix, validation, retry, discarded fix log |
| [sweep](sweep.md) | Implemented | Multi-round layered scan-fix-verify loop, regression detection |
| enrich | Implemented | Ollama LLM summaries for findings (auto or manual) |

## Writing specs

Each spec should define:
- **User story:** Who wants what and why
- **Acceptance criteria:** Observable behaviors that must be true
- **Edge cases:** What happens when agents fail, return garbage, or timeout
- **Not in scope:** Explicitly state what this spec does NOT cover
