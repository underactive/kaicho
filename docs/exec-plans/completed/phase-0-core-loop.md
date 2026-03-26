# Plan: Phase 0 — Core Loop + Multi-Agent Orchestration

**Goal:** Prove the core loop (invoke agent → capture output → structure suggestions) and extend to all 4 agents with cross-agent deduplication.
**Status:** Completed
**Started:** 2026-03-26
**Completed:** 2026-03-26

## Context

Kaicho had comprehensive documentation but zero implementation code. The user
pays for Claude, Codex, Gemini, and Cursor and wants all four earning their
keep. Phase 0 proves the core primitive: run agents against a repo and collect
structured suggestions.

## Steps

- [x] Project scaffolding (package.json, tsconfig, git init)
- [x] Types layer: Suggestion zod schema, AgentAdapter interface, RunResult
- [x] Config, logger, prompts (security scan)
- [x] Output parser with per-item zod validation + test fixtures
- [x] Codex adapter (subprocess via execa, -o file extraction, JSONL fallback)
- [x] Suggestion store (JSON files in .kaicho/runs/, symlink protection)
- [x] Orchestrator wiring adapter → parser → store
- [x] CLI: kaicho scan command, human/JSON formatters
- [x] Security fixes found by Codex scanning its own codebase
- [x] Claude, Cursor, Gemini adapters
- [x] parseFromText for agents without schema enforcement
- [x] Multi-agent parallel orchestration (Promise.allSettled)
- [x] Cross-agent deduplication (file+line proximity clustering)
- [x] Prompt scoping (--scope, --files flags)
- [x] kaicho report command (view past results)
- [x] kaicho list command (show installed agents)
- [x] kaicho init + config file support
- [x] QA and docs task types
- [x] Severity filter (--min-severity)
- [x] README

## Decisions

- 2026-03-26: **Codex as first adapter, not Claude.** User already uses Claude
  daily — Kaicho's purpose is to activate unused tools. Starting with Codex
  proves the value proposition immediately.
- 2026-03-26: **Nullable fields, not optional in Suggestion schema.** OpenAI's
  structured output requires all properties in `required` with
  `type: ["T", "null"]`. Using `.nullable()` in zod matches this constraint.
- 2026-03-26: **`-o` file as primary extraction for Codex.** Codex's `-o` flag
  writes clean structured JSON without JSONL event wrapping. JSONL parsing is
  the fallback.
- 2026-03-26: **Per-item validation in parser.** Don't reject all suggestions if
  one is malformed. Parse each individually, keep valid items, log rejected.
- 2026-03-26: **Prompt-based scoping.** Instead of sandboxing agent file access,
  inject a file manifest into the prompt. Agents are instruction-following LLMs
  and respect scope instructions.
- 2026-03-26: **Proximity-based dedup (±5 lines).** Simple greedy clustering by
  file+line proximity. Good enough for Phase 1; embedding-based similarity can
  come later.
- 2026-03-26: **parseFromText for Cursor/Gemini.** These agents lack schema
  enforcement. Brace-depth tracking parser extracts JSON from freeform text
  including markdown fences.

## Metrics

- 13 commits
- 66 tests, 8 test files
- 3 production dependencies (zod, commander, execa)
- 4 agent adapters, 3 task types
- Successfully scanned a real hardware project (ghost_operator) with all 4
  agents: 28 suggestions collapsed to 19 clusters, 2 multi-agent agreements
