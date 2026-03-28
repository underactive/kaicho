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
| `agent-adapters`  | A     | 4 adapters, 25 tests, verbose stderr, non-interactive flags | 2026-03-27 |
| `output-parser`   | A     | 3 parse paths, per-item validation, 15 tests    | 2026-03-26    |
| `suggestion-store`| A     | Symlink/traversal protection, 6 tests           | 2026-03-26    |
| `dedup`           | A     | Proximity clustering, severity filter, 12 tests | 2026-03-26    |
| `scope`           | A     | git ls-files + fallback, glob matching, 9 tests | 2026-03-26    |
| `orchestrator`    | A     | Scan + fix + parallel-fix + retry + validation, shared resolveAdapter, 34 tests | 2026-03-27 |
| `cli`             | A-    | 6 commands, 2 formatters, 12 formatter tests      | 2026-03-27    |
| `config`          | B+    | Config load + merge works, no tests (simple)     | 2026-03-26    |
| `prompts`         | A     | 8 scan tasks + fix + retry + validate (category-scoped), 14 tests | 2026-03-27 |
| `logger`          | B+    | Minimal structured logger, no tests (trivial)    | 2026-03-26    |
| `types`           | A     | Zod schemas, AgentMode, clean interfaces         | 2026-03-26    |
| `branch`          | A     | Create/diff/commit/discard/reset + worktree lifecycle, 8 tests | 2026-03-27 |
| `fix-log`         | A-    | Self-pruning fix + discarded fix log, no tests    | 2026-03-27    |
| `summarizer`      | B+    | Ollama integration, graceful fallback, no tests  | 2026-03-26    |
| `repo-context`    | —     | Not yet implemented (scoping partially covers)   | 2026-03-26    |

## Cross-cutting grades

| Concern           | Grade | Notes                                          | Last reviewed |
|-------------------|-------|-------------------------------------------------|---------------|
| Logging           | B+    | Structured JSON to stderr, ~10 call sites       | 2026-03-26    |
| Error handling    | A     | Adapters never throw, parse-at-boundary enforced | 2026-03-26    |
| Test coverage     | A-    | 144 tests across 17 files, all critical domains covered | 2026-03-27 |
| Documentation     | B+    | README, specs, exec plan, architecture doc       | 2026-03-26    |

## Process

- Review and update grades when a domain ships or changes significantly.
- A domain at grade C or below should have an entry in
  [tech-debt-tracker.md](exec-plans/tech-debt-tracker.md).
- Background cleanup tasks target the lowest-graded domains first.
