# Plan: kaicho fix — Apply Scan Suggestions via Agents

**Goal:** Let users dispatch an AI agent to apply fixes from scan results, working on an isolated branch so the user's working copy is never modified directly.
**Status:** Completed (Phase A + B)
**Started:** 2026-03-26
**Completed:** 2026-03-26

## Context

Kaicho scan produces structured suggestions with `file`, `line`, `rationale`,
and `suggestedChange`. The fix command closes the loop: read a scan result,
dispatch an agent with write access to apply the fix, capture the diff, and
let the user review.

## What was built

### Phase A: Single-fix, single-agent, isolated branch
- [x] Fix prompt builder from SuggestionCluster
- [x] AgentMode ("scan" | "fix") on adapter interface with write-mode flags
- [x] Branch manager: create, diff, commit, discard, keep
- [x] CLI command with interactive picker, --id, --cluster selection
- [x] Product spec
- [x] Tests for prompt builder and branch manager
- [x] Progress feedback (step-by-step TTY + JSONL)

### Phase B: Batch fix with confirmation loop
- [x] --batch: iterate all findings on one branch
- [x] Per-fix confirmation: continue/skip/stop
- [x] --auto: skip confirmations for CI/brave users
- [x] Each fix gets its own commit (individually revertable)
- [x] Cumulative summary at the end

### Additional (built during Phase A/B)
- [x] Short IDs on clusters (6-char hex, stable)
- [x] Ollama summaries via local LLM (qwen3:1.7b)
- [x] Agent picker for multi-agent findings
- [x] Fix log (.kaicho/fixed.json) — tracks applied fixes, self-pruning
- [x] Dedup improvements: Jaccard keyword similarity (pass 2)

## Decisions

- **Work on a git branch, not the working copy.** Branch approach is safer;
  user may want to keep, modify, or merge changes.
- **Single agent per fix.** Multiple agents would create conflicting edits.
- **Default to the agent that found the issue.** It has context. --agent overrides.
- **Refuse on dirty working tree.** Don't mix fix changes with uncommitted work.
- **Fix prompt lets agent read the file.** Prompt provides location + rationale,
  agent reads surrounding context itself.
- **Show full diff, let user decide.** Don't restrict agent changes.
- **Fix log self-prunes.** Entries removed when branch deleted or after 30 days.

## Open questions (resolved)

- Freeform instructions: Not implemented. Scan results only for now.
- Agent changes beyond suggested fix: Full diff shown, user decides.
- Uncommitted changes: Refused with clear error message.

## Phase C (future)

- Route to agent that found the issue (partially done — it's the default)
- `--validate` flag: run second agent to review the diff
- Conflict detection: warn if two fixes touch the same lines
