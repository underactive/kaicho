# Plan: kaicho fix — Apply Scan Suggestions via Agents

**Goal:** Let users dispatch an AI agent to apply fixes from scan results, working on an isolated branch so the user's working copy is never modified directly.
**Status:** Active
**Started:** 2026-03-26

## Context

Kaicho scan produces structured suggestions with `file`, `line`, `rationale`,
and `suggestedChange`. Currently the user reads these and manually applies
fixes. The fix command closes the loop: read a scan result, dispatch an agent
with write access to apply the fix, capture the diff, and let the user review.

Per SECURITY.md: "Suggestions are read-only by default. Kaicho does not
auto-apply them unless the user explicitly opts in." And: "Worktrees are
disposable. Never modify the user's working copy."

## Phased approach

### Phase A: Single-fix, single-agent, isolated branch
The smallest useful thing. User picks one finding, one agent applies it on a
new branch.

```
kaicho fix --repo=~/project
  → reads .kaicho/latest.json (or --run=<file>)
  → shows numbered list of clusters
  → user picks a cluster (or --cluster=<n>)
  → creates git branch: kaicho/fix-<short-hash>
  → dispatches one agent with write access + fix prompt
  → shows git diff of what changed
  → user decides: keep branch, merge, or discard
```

**Steps:**
- [ ] Fix prompt builder: takes a SuggestionCluster, produces a focused
      prompt with file, line, rationale, suggestedChange
- [ ] Fix adapter mode: each agent adapter gets a `fix()` method (or reuse
      `run()` with write-mode flags instead of read-only flags)
- [ ] Branch manager: create branch, run agent, capture diff, cleanup on
      discard
- [ ] CLI command: `kaicho fix` with interactive cluster selection
- [ ] Product spec for fix command
- [ ] Tests for prompt builder and branch manager

**Agent write-mode flags:**
| Agent  | Scan (read-only)              | Fix (write access)                    |
|--------|-------------------------------|---------------------------------------|
| Claude | `--permission-mode plan`      | `--permission-mode acceptEdits`       |
| Codex  | `-s read-only`                | `-s workspace-write` or `--full-auto` |
| Cursor | `--mode plan`                 | `--trust` (default mode, no plan)     |
| Gemini | `--sandbox`                   | `--approval-mode auto_edit`           |

### Phase B: Batch fix with confirmation loop
Apply multiple fixes in sequence on the same branch. After each fix, show
the diff and ask continue/skip/stop.

**Steps:**
- [ ] Batch mode: iterate clusters by priority (agreement desc, severity desc)
- [ ] Per-fix confirmation: show diff, prompt continue/skip/stop
- [ ] Cumulative diff summary at the end
- [ ] `--auto` flag to skip confirmations (for CI/brave users)

### Phase C: Smart routing and validation
Route each fix to the best agent and optionally validate with a second agent.

**Steps:**
- [ ] Route to the agent that found the issue (highest-confidence fix)
- [ ] `--validate` flag: after fixing, run a second agent to review the diff
- [ ] Conflict detection: if two fixes touch the same lines, warn

## Decisions

- 2026-03-26: **Work on a git branch, not the working copy.** Per SECURITY.md
  "worktrees are disposable" and "never modify the user's working copy." The
  branch approach is safer than worktrees for the fix case because the user
  may want to keep, modify, or merge the changes — worktrees are better for
  ephemeral read-only operations.
- 2026-03-26: **Single agent for fix, not multi-agent.** Unlike scan (which
  benefits from multiple perspectives), fix needs one agent making coherent
  changes. Running multiple agents would create conflicting edits.
- 2026-03-26: **Default to the agent that found the issue.** It already has
  context on what's wrong. User can override with `--agent`.
- 2026-03-26: **Phase A first.** Per product principle #3 "Incremental, not
  ambitious" — ship single-fix before batch, batch before smart routing.

## Open questions

- Should fix use `kaicho scan` results only, or also accept a freeform
  instruction? (Leaning: scan results only for Phase A, freeform later.)
- Should the fix prompt include surrounding code context, or let the agent
  read the file? (Leaning: let the agent read the file — it needs full
  context to make a coherent edit.)
- What happens if the agent makes changes beyond the suggested fix?
  (Leaning: show the full diff and let the user decide. Don't restrict.)
- How to handle uncommitted changes in the user's working copy?
  (Leaning: refuse to run if working tree is dirty, suggest commit/stash.)
