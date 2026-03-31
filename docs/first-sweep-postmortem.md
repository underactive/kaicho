# First Sweep Postmortem

**Date:** 2026-03-31
**Repo:** `ghost_operator` (nRF52 firmware + Vue dashboard)
**Command:** `kaicho sweep --repo=~/Development/personal/hardware/ghost_operator --auto --validate --max-rounds=1`
**Runtime:** 8h 0m 35s (after a false start)

---

## Summary

First real-world sweep against a small firmware project (C/C++ + JS/Vue,
~10 source files). The sweep found 140 issues across 7 layers and fixed 130.
Two layers failed due to a cascading merge conflict. A prior attempt was
aborted after 46 minutes when a rejected suggestion created confusion.

---

## Results by layer

| Layer | Task | Findings | Fixed | Skipped | Wall time |
|-------|------|----------|-------|---------|-----------|
| 1 | security | 18 | 18 | 0 | ~41m |
| 2 | qa | 29 | 26 | 3 | ~68m |
| 3 | contracts, state | 40 | 38 | 2 | ~87m |
| 4 | resources, resilience | 35 | 31 | 4 | ~94m |
| 5 | performance | 18 | 17 | 1 | ~75m |
| 6 | logging | **failed** | 2 | — | ~10m |
| 7 | testing, docs, dx | **failed** | 0 | — | scan only |

**Final:** 130 fixed, 264 remaining (34 critical, 51 high, 98 medium,
75 low, 6 info), 0 regressions.

---

## What went well

- **100% fix rate through Layer 5.** Layers 1-5 completed cleanly. Every
  finding that was attempted was either fixed or explicitly skipped by
  validation (auto-concern). Zero regressions.
- **Cross-agent validation is working.** 4 fixes were discarded with
  `auto-concern` — the validation reviewer caught fixes that could
  introduce new problems. No false negatives observed.
- **Parallel batching works.** First 5-10 findings per layer are fixed in
  parallel (batch size 5), cutting wall time significantly for the early
  part of each layer.
- **Worktree isolation is solid.** ~60 fix worktrees were created, used,
  and cleaned up across the run. No stale worktrees left behind.

---

## What went wrong

### 1. Cascading merge conflict killed Layers 6 and 7

Three fix branches in Layer 6 all touched `src/ghost_operator.ino`. The
first merge (`kaicho/fix-6e9b4571`) hit a content conflict. The sweep
logged "deferring for retry" but didn't `git merge --abort`, leaving the
worktree dirty. The next two merges immediately failed with "Merging is
not possible because you have unmerged files." The sweep then errored:

```
Layer failed, continuing — Error: Working tree has uncommitted changes.
```

Layer 7 inherited the dirty worktree and also failed immediately. 93
findings were scanned but 0 were fixed.

**Impact:** Two entire layers of work lost. This is the highest-priority
bug to fix.

**Fix:** After a failed squash-merge, the sweep must `git merge --abort`
(or `git reset --merge`) before attempting the next merge or continuing
to the next layer.

### 2. Aborted first run (rejected suggestion enum)

A suggestion with `category: 'race'` was rejected because `'race'` is
not in the category enum. Kaicho handled this correctly (logged a warn,
continued), but the log output made it look like the sweep was broken,
prompting a Ctrl-C after 46 minutes. The first run had already fixed 16
findings that were lost when `.kaicho/` was cleared.

**Fix:** Consider adding `race` to the category enum (valid for firmware
with concurrency concerns), or mapping unknown categories to `bug` with
a warn instead of rejecting the entire suggestion.

### 3. Codex agent silently absent from second run

The first run had 4 agents (claude, codex, cursor:comp, gemini). The
second run only shows 3 — Codex never appears in any scan. No error was
logged. It either failed to start or returned 0 suggestions silently.

**Impact:** 25% fewer findings and less reviewer diversity for the
entire 8-hour run.

**Fix:** Log a warning when an expected agent produces no output or
fails to start.

---

## Performance observations

### Serial fix phase dominates runtime

After the parallel batches (size 5), the pipeline drops to serial
(size 1) for findings that share files. `src/ble_uart.cpp` appears in
nearly every layer and forces serial execution each time. Each serial
fix cycle (worktree create → agent fix → validation → merge cleanup)
takes ~90-120 seconds, so a layer with 15 serial fixes burns 25-30
minutes in serial alone.

**Optimization:** Batch all findings for the same file into a single
agent session rather than N sequential fix cycles.

### Post-round scan overhead (~1.5 hours)

After all fixes complete, the sweep runs a full re-scan across every
task (security, qa, contracts, state, resources, resilience,
performance, logging, testing, docs, dx — 11 scans × 3 agents each).
This ran from ~09:19 to ~10:49 with zero fixes applied
(`--max-rounds=1`).

**Optimization:** Skip the final scan pass when `max-rounds` is
exhausted, or make it opt-in (`--final-scan`).

### Gemini suggestion volume in late layers

In post-round scans, Gemini produced 86 suggestions for docs and 43 for
testing in single passes. These likely inflate the "264 remaining" count
with low-signal items for a small firmware project.

**Optimization:** Cap suggestions per agent per scan, or weight agents
by signal quality for non-critical layers.

### Time budget breakdown

| Phase | Estimated time | % of total |
|-------|---------------|------------|
| Layer 1-5 fix cycles (scan + fix + validate + merge) | ~6h 5m | 76% |
| Post-round scans (no fixes) | ~1h 30m | 19% |
| Layer 6-7 (failed / scan-only) | ~25m | 5% |

---

## Duplicate findings across layers

Several code patterns were flagged in multiple layers under different
categories:

- `cmdQueryKeys()` buffer overflow — security (Layer 1), then qa (Layer 2)
- `rxBuffer` silent discard — security (Layer 1), then qa (Layer 2)
- BLE device name validation loop — security (Layer 1), then security
  again post-fix
- Device name XSS in Vue — security (Layer 1), then qa (Layer 2)

Deduplication by cluster ID catches some of these, but the
scan-fix-rescan cycle means agents keep re-flagging the same code
patterns under different categories.

---

## Optimization priorities (ranked by impact)

1. **Fix merge-conflict recovery** — `git merge --abort` + continue.
   Would have saved Layers 6+7 entirely.
2. **Skip final scan when max-rounds exhausted** — saves ~1.5 hours.
3. **Batch same-file findings into single fix sessions** — could cut
   serial phase by 50-70%.
4. **Log warnings for silent agent failures** — Codex vanishing silently
   is unacceptable when you're paying for 4 agents.
5. **Cap or weight suggestions in non-critical layers** — reduces
   scan-time noise from Gemini.

---

## Raw data

- Sweep log: `kaicho_sweep-ghost_operator-20250330.txt` (2,445 lines,
  375 KB)
- Sweep report: `ghost_operator/.kaicho/sweep-report.json`
- Branch: `kaicho/sweep-ba6cbd58` (not checked out)
