# Plan: Retry Fix with Reviewer Agent

**Goal:** When validation raises a concern, let the user retry the fix with the reviewing agent instead of only continue/skip/stop.
**Status:** Completed
**Started:** 2026-03-27
**Completed:** 2026-03-27

## Context

When `kaicho fix --validate` raises a concern, the reviewer agent has
detailed knowledge of what's wrong — it should be able to re-do the fix
itself. Added an "r" (retry with reviewer) option at the prompt.

Real scenario: Codex applies a fix, Claude reviews and says "this breaks
the dashboard's serial transport." The user presses "r", the failed fix is
reverted, and Claude applies a better fix using its own concern as context.

## What shipped

- **Retry option** in batch fix (`c/s/x/r`) and single fix (`k/d/r`)
- **`git reset --hard HEAD~1`** to cleanly revert failed fix (local branch)
- **Three-context retry prompt**: original finding + failed diff + reviewer's concern
- **One retry max** — `retryOf` field suppresses further retry offers
- **Fixer context pipeline** (`<FIX_CONTEXT>` block): fixer explains approach,
  alternatives rejected, and tradeoffs; forwarded to reviewer
- **Category-scoped validation prompt**: explicit scope/out-of-scope/unrelated
  per category to prevent reviewer drift
- **`--verbose` flag**: streams agent stderr to terminal for debugging
- **`--full-auto` on Codex** scan/review modes to prevent plan-approval prompts
- **30-minute default timeout** centralized in `DEFAULT_TIMEOUT_MS`
- **Shared `resolveAdapter`** extracted to deduplicate across 3 orchestrator files
- **Cluster summary** shown in batch fix progress output

## Decisions

- 2026-03-27: `git reset --hard` not `git revert` — branch is local, no
  shared history to preserve.
- 2026-03-27: One retry only. After retry, prompt shows c/s/x (no "r").
  Prevents infinite loops.
- 2026-03-27: Retry fix validated too (batch: via onConfirm loop; single:
  explicit re-validation call). Reviewer's fix gets reviewed by a different agent.
- 2026-03-27: `<FIX_CONTEXT>` extraction is best-effort — graceful fallback
  if agent doesn't include the block.
- 2026-03-27: Category scope map hardcoded per category (6 categories).
  Prevents reviewer from rejecting a security fix for style concerns.

## Files changed

- `src/branch/manager.ts` — `resetLastCommit()`
- `src/prompts/fix.ts` — `buildRetryFixPrompt()`, `extractFixerContext()`, FIX_CONTEXT instructions
- `src/prompts/validate.ts` — category-scoped review context, fixerContext param
- `src/orchestrator/resolve-adapter.ts` — shared adapter factory (new file)
- `src/orchestrator/batch-fix-retry.ts` — extracted retry execution (new file)
- `src/orchestrator/run-batch-fix.ts` — `BatchFixConfirmResult` union, retry handling
- `src/orchestrator/run-fix.ts` — verbose + fixerContext support
- `src/orchestrator/run-validate.ts` — verbose + fixerContext passthrough
- `src/agent-adapters/*.ts` — verbose stderr streaming, `DEFAULT_TIMEOUT_MS`, Codex `--full-auto`
- `src/cli/commands/fix.ts` — retry prompts, `--verbose` flag, fixer context threading
- `src/orchestrator/commit-message.ts` — "Applied by Kaichō via Agent" signature
- `src/config/defaults.ts` — 30-minute default timeout
