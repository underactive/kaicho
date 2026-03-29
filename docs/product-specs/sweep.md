# Spec: kaicho sweep

**User story:** As a developer maintaining a codebase, I want to run a
comprehensive multi-domain scan-fix-verify loop so I can converge toward zero
critical issues across all quality dimensions without manually orchestrating
individual scan and fix passes.

## Acceptance criteria

- Processes all 11 scan tasks in a fixed priority order (7 layers)
- Fixes all severity levels in each layer (critical through info)
- After fixing a layer, checks the previous layer for regressions
- Reverts layer fixes if regressions are detected in a higher-priority layer
- Exits when zero critical/high findings remain in security + qa
- Stops after max rounds (configurable, default: 3) even if findings remain
- Supports auto mode (`--auto`) for unattended execution
- Supports interactive mode (default) for per-fix confirmation
- Writes `.kaicho/sweep-report.json` with full run details
- Writes `.kaicho/sweep-regressions.json` when regressions are detected
- Creates a sweep branch (`kaicho/fix-*`) for all changes
- Shows layer-by-layer progress in TTY mode, JSON in piped mode
- Shows round summary with findings/fixed/remaining counts
- Shows final summary with severity breakdown of remaining findings
- `maxSweepRounds` configurable via `kaicho.config.json`

## Layer ordering

| Layer | Tasks | Priority rationale |
|-------|-------|--------------------|
| 1 | security | Highest stakes, non-negotiable |
| 2 | qa | Correctness bugs |
| 3 | contracts, state | Boundary and data flow issues |
| 4 | resources, resilience | Operational correctness |
| 5 | performance | Optimization (must not override security/qa) |
| 6 | logging | Observability |
| 7 | testing, docs, dx | Process quality |

See [sweep-layers.md](../design-docs/sweep-layers.md) for full rationale.

## Edge cases

- All tasks return zero findings → exits immediately (round 1, zero-critical-high)
- Fix agent not available → status: "agent-error", continues with next finding
- Merge conflict when incorporating fix branch → skip, log warning
- Regression detected → revert all layer fixes, log to regressions report
- Max rounds reached with findings remaining → exit with "max-rounds", report remaining

## Not in scope

- Custom layer ordering (hardcoded for v1)
- Per-layer task selection (runs all 11 tasks)
- Incremental sweep (resume from previous sweep)
- CI integration (webhook, PR comments)
