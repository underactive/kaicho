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

### Sweep regression revert is all-or-nothing
- **Domain:** orchestrator (sweep)
- **Grade impact:** reliability
- **Severity:** low
- **Added:** 2026-03-29
- **Notes:** When a layer's fixes cause a regression in the previous layer, all fixes from that layer are reverted — even if only one fix was responsible. A binary-search bisection approach (log₂(N) re-scans instead of N) would preserve the non-regressing fixes while still reverting the offender. See `run-sweep.ts:183-185`.

## Resolved debt

(none yet)

## Process

- When you discover tech debt during a task, add it here rather than fixing
  it inline (unless the fix is trivial and scoped to your current change).
- Cleanup tasks should reference the specific item they resolve.
- Move resolved items to the "Resolved" section with the date and PR/commit.
