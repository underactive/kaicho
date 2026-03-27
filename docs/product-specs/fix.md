# Spec: kaicho fix

**User story:** As a developer who has reviewed scan findings, I want to
dispatch an AI agent to apply a fix so I get a working patch without
writing the code myself.

## Acceptance criteria

- Reads clusters from the latest scan results in `.kaicho/runs/`
- Shows a numbered list of findings for interactive selection
- Accepts `--cluster=N` to skip interactive picker
- Defaults to the agent that found the issue; `--agent` overrides
- Creates a git branch `kaicho/fix-<hash>` before applying changes
- Dispatches agent with write-access flags (not read-only)
- Shows the git diff after the agent finishes
- Prompts user to keep or discard the branch
- Refuses to run if working tree has uncommitted changes
- Filters findings by `--task` and `--min-severity`
- Expands `~` in `--repo` path
- Never modifies the user's current branch directly

## Edge cases

- No scan results exist → error suggesting to run scan first
- Agent makes no changes → "no changes" message, branch discarded
- Agent errors or times out → error message, branch discarded
- Working tree is dirty → error suggesting commit/stash
- Agent that found the issue is not installed → fall back to next available, or error with `--agent` override hint

## Batch mode (Phase D — parallel worktrees)

- `--batch` runs fixes in parallel using git worktrees (up to 3 concurrent)
- Each fix gets its own branch: `kaicho/fix-<hash>`
- After all parallel fixes complete, user confirms each individually: keep/discard/retry
- `--auto` keeps all applied fixes without prompting
- Worktrees are temporary (created in system tmpdir, cleaned up after)
- Main worktree stays on user's current branch throughout
- Summary shows kept and discarded branches
- Warns if two kept branches modify the same file (potential merge conflict)
- User merges individually: `git merge kaicho/fix-<hash>`

## Validation (Phase C)

- `--validate` dispatches a second agent to review the diff after each fix
- Reviewer is a different agent from the fixer (prefers agents that found the issue)
- `--reviewer <agent>` overrides auto-pick (also settable in `kaicho.config.json`)
- Verdict: approve or concern, with rationale
- Single fix: shows validation before keep/discard prompt
- Batch fix: shows validation after each fix diff
- `--auto --validate`: auto-skips fixes that receive "concern" verdict
- Skips validation if only one agent is installed
- Conflict detection: in batch mode, skips fixes targeting already-modified files
- Validation prompt is category-scoped — reviewer can only reject for issues
  within the fix's category (a security fix can't be rejected for style concerns)

## Retry with reviewer

- When validation raises a concern, user can press `r` to retry
- Batch fix: `c/s/x/r` prompt after concern; single fix: `k/d/r` prompt
- Retry reverts the failed commit (`git reset --hard HEAD~1`), then runs
  the reviewer agent in fix mode with three-context prompt: original finding,
  failed diff, and the reviewer's concern
- One retry max — after retry, prompt shows `c/s/x` (batch) or `k/d` (single)
- Retry result is also validated (by a different agent)

## Fixer context

- Fix prompt asks the agent to output a `<FIX_CONTEXT>` block after applying
  changes: approach chosen, alternatives rejected, tradeoffs accepted
- Extracted from raw output and forwarded to the reviewer
- Reviewer sees fixer's reasoning, reducing false concerns from scope mismatch
- Graceful fallback if agent doesn't include the block

## Verbose mode

- `--verbose` streams agent stderr to the terminal in real-time
- Useful for debugging stuck agents (e.g., waiting for plan approval)
- Agent output is still captured for error diagnostics

## Not in scope

- Auto-merging the fix branch
- Freeform fix instructions (not from scan results)
