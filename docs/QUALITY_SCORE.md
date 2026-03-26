# Quality Score

Tracks the current quality grade of each domain and architectural layer.
Updated as domains are built. Agents and humans use this to prioritize
cleanup and investment.

## Grading scale

| Grade | Meaning                                                    |
|-------|------------------------------------------------------------|
| A     | Well-tested, documented, agent-legible, no known debt      |
| B     | Functional and tested, minor gaps in docs or edge cases    |
| C     | Works but has known debt, missing tests, or unclear naming |
| D     | Fragile, undertested, or structurally problematic          |
| F     | Broken or placeholder only                                 |

## Domain grades

| Domain            | Grade | Notes                              | Last reviewed |
|-------------------|-------|------------------------------------|---------------|
| `agent-adapters`  | —     | Not yet implemented                | —             |
| `repo-context`    | —     | Not yet implemented                | —             |
| `output-parser`   | —     | Not yet implemented                | —             |
| `suggestion-store`| —     | Not yet implemented                | —             |
| `orchestrator`    | —     | Not yet implemented                | —             |
| `cli`             | —     | Not yet implemented                | —             |

## Cross-cutting grades

| Concern           | Grade | Notes                              | Last reviewed |
|-------------------|-------|------------------------------------|---------------|
| Logging           | —     | Not yet implemented                | —             |
| Error handling    | —     | Not yet implemented                | —             |
| Test coverage     | —     | Not yet implemented                | —             |
| Documentation     | C     | Scaffolded, not yet battle-tested  | 2026-03-26    |

## Process

- Review and update grades when a domain ships or changes significantly.
- A domain at grade C or below should have an entry in
  [tech-debt-tracker.md](exec-plans/tech-debt-tracker.md).
- Background cleanup tasks target the lowest-graded domains first.
