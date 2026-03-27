# Quality Score

Tracks the current quality grade of each domain and architectural layer.
Updated as domains are built. Agents and humans use this to prioritize
cleanup and investment.

## Grading scale

| Grade | Meaning                                                    |
|-------|-----------------------------------------------------------|
| A     | Well-tested, documented, agent-legible, no known debt      |
| B     | Functional and tested, minor gaps in docs or edge cases    |
| C     | Works but has known debt, missing tests, or unclear naming |
| D     | Fragile, undertested, or structurally problematic          |
| F     | Broken or placeholder only                                 |

## Domain grades

| Domain            | Grade | Notes                                          | Last reviewed |
|-------------------|-------|-------------------------------------------------|---------------|
| `agent-adapters`  | A     | 4 adapters, 25 tests, never-throw contract      | 2026-03-26    |
| `output-parser`   | A     | 3 parse paths, per-item validation, 15 tests    | 2026-03-26    |
| `suggestion-store`| A     | Symlink/traversal protection, 6 tests           | 2026-03-26    |
| `dedup`           | A     | Proximity clustering, severity filter, 12 tests | 2026-03-26    |
| `scope`           | A     | git ls-files + fallback, glob matching, 9 tests | 2026-03-26    |
| `orchestrator`    | B     | Parallel dispatch works, no unit tests           | 2026-03-26    |
| `cli`             | B     | 4 commands, 2 formatters, no unit tests          | 2026-03-26    |
| `config`          | B+    | Config load + merge works, no tests (simple)     | 2026-03-26    |
| `prompts`         | B+    | 3 task types, shared schema, no tests (templates)| 2026-03-26    |
| `logger`          | B+    | Minimal structured logger, no tests (trivial)    | 2026-03-26    |
| `types`           | A     | Zod schemas, clean interfaces                    | 2026-03-26    |
| `repo-context`    | —     | Not yet implemented (scoping partially covers)   | 2026-03-26    |

## Cross-cutting grades

| Concern           | Grade | Notes                                          | Last reviewed |
|-------------------|-------|-------------------------------------------------|---------------|
| Logging           | B+    | Structured JSON to stderr, ~10 call sites       | 2026-03-26    |
| Error handling    | A     | Adapters never throw, parse-at-boundary enforced | 2026-03-26    |
| Test coverage     | B+    | 66 tests, critical domains covered, orchestrator/CLI gaps | 2026-03-26 |
| Documentation     | B+    | README, specs, exec plan, architecture doc       | 2026-03-26    |

## Process

- Review and update grades when a domain ships or changes significantly.
- A domain at grade C or below should have an entry in
  [tech-debt-tracker.md](exec-plans/tech-debt-tracker.md).
- Background cleanup tasks target the lowest-graded domains first.
