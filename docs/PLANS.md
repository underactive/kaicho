# Plans Index

Plans are first-class artifacts in Kaicho. Complex work gets an execution plan
checked into the repo. Small changes use ephemeral plans (inline in the PR
description or a task tool).

## Active plans

| Plan | Goal | Owner | Started |
|------|------|-------|---------|
| (none) | — | — | — |

See [exec-plans/active/](exec-plans/active/) for full plan documents.

## Completed plans

| Plan | Goal | Completed |
|------|------|-----------|
| [Phase 0](exec-plans/completed/phase-0-core-loop.md) | Core loop + multi-agent orchestration | 2026-03-26 |
| [fix-command](exec-plans/completed/fix-command.md) | Apply scan suggestions via agents (Phase A + B) | 2026-03-26 |
| [fix-phase-c](exec-plans/completed/fix-phase-c.md) | Validation + conflict detection (Phase C) | 2026-03-27 |

See [exec-plans/completed/](exec-plans/completed/) for full plan documents.

## Creating a plan

Use an execution plan when the work:
- Touches 3+ domains or files
- Requires multiple sequential steps with dependencies
- Involves a non-obvious architectural decision
- Will take more than one session to complete

### Plan template

```markdown
# Plan: <title>

**Goal:** One sentence.
**Status:** Active | Blocked | Completed
**Started:** YYYY-MM-DD

## Context
Why this work is needed.

## Steps
- [ ] Step 1
- [ ] Step 2

## Decisions
- YYYY-MM-DD: Decided X because Y.

## Open questions
- Question?
```

Save to `docs/exec-plans/active/<slug>.md`. Move to `completed/` when done.
