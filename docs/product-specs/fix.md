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

## Batch mode (Phase B)

- `--batch` iterates all findings on one branch with continue/skip/stop
- `--auto` skips confirmations (applies all fixes without prompting)
- Each fix gets its own commit (individually revertable)
- Summary at the end: N applied, N skipped, N failed
- One branch to merge: `kaicho/fix-<hash>`

## Not in scope

- Auto-merging the fix branch
- Cross-agent validation of fixes (Phase C)
- Freeform fix instructions (not from scan results)
