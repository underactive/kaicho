# Plan: Fix Phase C — Validation + Conflict Detection

**Goal:** Add a `--validate` flag that dispatches a second agent to review the fix diff, and detect conflicting fixes in batch mode.
**Status:** Completed
**Started:** 2026-03-27
**Completed:** 2026-03-27

## Context

Phase A+B shipped single and batch fix. The fix agent works alone — no
second opinion. Multi-agent consensus is Kaicho's core value for scans;
it should apply to fixes too.

`--validate` runs a second agent after the fix to review the diff. If the
reviewer finds issues, the user sees the review alongside the diff and
decides whether to keep or discard. This catches hallucinated fixes,
regressions, or incomplete changes.

## Phased steps

### Step 1: Validation prompt + reviewer dispatch
- [ ] New `buildValidationPrompt(cluster, diff)` — asks reviewer to check
      whether the diff correctly addresses the finding, introduces new issues,
      or is incomplete
- [ ] Reviewer returns structured response: `{verdict: "approve"|"concern", rationale: string}`
- [ ] Pick reviewer agent: different from the fix agent. If only 1 agent
      installed, skip validation with a warning.

### Step 2: Wire into single fix
- [ ] `--validate` flag on `kaicho fix`
- [ ] After fix applied + diff captured, dispatch reviewer
- [ ] Show review result before keep/discard prompt
- [ ] Progress callback for validation step

### Step 3: Wire into batch fix
- [ ] `--validate` works with `--batch`
- [ ] After each fix, run validation before continue/skip/stop prompt
- [ ] `--auto` with `--validate`: auto-skip fixes that get "concern" verdict

### Step 4: Conflict detection in batch mode
- [ ] After each fix commit, track which file:line ranges were modified
- [ ] Before the next fix, check if the target overlaps with already-modified ranges
- [ ] If overlap: warn user, ask to skip or continue
- [ ] In `--auto` mode: skip conflicting fixes

## Decisions

- 2026-03-27: **Reviewer is a different agent than the fixer.** Same agent
  reviewing its own work has limited value. Cross-agent review catches
  different failure modes.
- 2026-03-27: **Verdict is binary: approve/concern.** Not a score or
  multi-level rating. Keeps the UX simple — either the review passes or
  it raises a concern that the user should look at.
- 2026-03-27: **Validation is opt-in.** `--validate` flag, not default.
  It doubles the time per fix (two agent calls instead of one). Users who
  want speed skip it; users who want confidence use it.

## Open questions

- Which agent should be the default reviewer? (Leaning: Claude, since it's
  the user's preferred tool and strongest at code review. Or the second
  agent in the cluster's agents list.)
- Should validation results be persisted? (Leaning: no, they're ephemeral
  — the diff and the user's keep/discard decision are what matter.)
