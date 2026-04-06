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
| `agent-adapters`  | A     | 5 adapters (+ OpenCode), CLI-lock serialization, OpenRouter compat, 25+ tests | 2026-04-05 |
| `output-parser`   | A     | Freeform multi-strategy parsing, field normalization, category/severity mapping, 25+ tests | 2026-04-05 |
| `suggestion-store`| A     | SQLite-backed, symlink/traversal protection      | 2026-04-05    |
| `dedup`           | A     | Proximity clustering, severity filter, 12 tests | 2026-03-26    |
| `scope`           | A     | git ls-files + fallback, glob matching, 9 tests | 2026-03-26    |
| `orchestrator`    | A     | Scan + fix + parallel-fix + retry + validation + sweep (single + two-pass), serial-phase batching, worktree isolation | 2026-04-05 |
| `cli`             | A-    | 7 commands, 2 formatters, 12 formatter tests      | 2026-03-29    |
| `config`          | B+    | Config load + merge works, no tests (simple)     | 2026-03-26    |
| `prompts`         | A     | 11 scan tasks + fix + retry + validate, FP filtering, confidence gating, phased methodology | 2026-04-05 |
| `logger`          | B+    | Minimal structured logger, no tests (trivial)    | 2026-03-26    |
| `types`           | A     | Zod schemas, AgentMode, clean interfaces         | 2026-03-26    |
| `branch`          | A     | Create/diff/commit/discard/reset + worktree lifecycle, 8 tests | 2026-03-27 |
| `fix-log`         | A-    | Self-pruning fix + discarded fix log, no tests    | 2026-03-27    |
| `summarizer`      | A-    | Ollama + OpenRouter integration, graceful fallback, no tests | 2026-04-05 |
| `repo-context`    | A     | Root + workspace fingerprint, format, 35 tests, graceful degradation | 2026-03-29 |
| `dashboard`       | B+    | SPA web UI, severity charts, discard reasons, no tests | 2026-04-05 |

## Cross-cutting grades

| Concern           | Grade | Notes                                          | Last reviewed |
|-------------------|-------|-------------------------------------------------|---------------|
| Logging           | B+    | Structured JSON to stderr, ~10 call sites       | 2026-03-26    |
| Error handling    | A     | Adapters never throw, parse-at-boundary enforced | 2026-03-26    |
| Test coverage     | A     | 481 tests across 27 files, all critical domains covered | 2026-04-05 |
| Documentation     | B+    | README, specs, exec plan, architecture doc       | 2026-03-26    |

## Process

- Review and update grades when a domain ships or changes significantly.
- A domain at grade C or below should have an entry in
  [tech-debt-tracker.md](exec-plans/tech-debt-tracker.md).
- Background cleanup tasks target the lowest-graded domains first.
