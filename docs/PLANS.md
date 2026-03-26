# Plans Index

Plans are first-class artifacts in Kaicho. Complex work gets an execution plan
checked into the repo. Small changes use ephemeral plans (inline in the PR
description or a task tool).

## Active plans

| Plan | Goal | Owner | Started |
|------|------|-------|---------|
| (none yet) | — | — | — |

See [exec-plans/active/](exec-plans/active/) for full plan documents.

## Completed plans

See [exec-plans/completed/](exec-plans/completed/) for historical plans with
decision logs.

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
