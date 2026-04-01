# Tech Debt Tracker

Known technical debt, tracked as inventory. Items here should be addressed
by targeted cleanup tasks on a regular cadence — not accumulated for a
"big refactor."

## Format

```
### <short title>
- **Domain:** which domain is affected
- **Grade impact:** what quality grade this drags down
- **Severity:** low | medium | high
- **Added:** YYYY-MM-DD
- **Notes:** context for why this exists and what fixing looks like
```

## Active debt

### Gemini suggestion volume in non-critical layers
- **Domain:** orchestrator (scan)
- **Grade impact:** performance
- **Severity:** low
- **Added:** 2026-03-31
- **Notes:** Gemini produced 86 suggestions for docs and 43 for testing in single scan passes on a small firmware project. Likely low-signal noise inflating remaining-findings counts. Consider per-agent suggestion caps or severity-weighted filtering for non-critical layers. Wait for second sweep data to confirm.

## Resolved debt

### Two-pass sweep strategy
- **Domain:** orchestrator (sweep)
- **Grade impact:** performance, reliability
- **Severity:** low
- **Added:** 2026-03-31
- **Resolved:** 2026-04-01. Implemented `--two-pass` CLI flag. Pass 1 runs all layers in reverse order (low→high) without regression checks or validation. Pass 2 runs only security + QA with full regression checks + validation on the clean base. Reduces regression check cost from O(n²) to O(1).

### Sweep regression revert is all-or-nothing
- **Domain:** orchestrator (sweep)
- **Grade impact:** reliability
- **Severity:** low
- **Added:** 2026-03-29
- **Resolved:** 2026-03-30. Replaced all-or-nothing auto-revert with flag-and-continue. Regressions are detected and reported but not auto-reverted — the user reviews `.kaicho/sweep-regressions.json` and decides. Additionally, regression checks now scan all previous layers, not just the immediately preceding one.

## Process

- When you discover tech debt during a task, add it here rather than fixing
  it inline (unless the fix is trivial and scoped to your current change).
- Cleanup tasks should reference the specific item they resolve.
- Move resolved items to the "Resolved" section with the date and PR/commit.
