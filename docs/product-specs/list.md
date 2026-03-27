# Spec: kaicho list

**User story:** As a developer setting up Kaicho, I want to see which AI
coding agents are installed on my system so I know what's available before
running a scan.

## Acceptance criteria

- Checks all configured agents (claude, codex, cursor, gemini)
- Shows install status and version for each
- Human-readable table in TTY mode
- JSON output when piped or `--json` is passed

## Edge cases

- Agent binary exists but returns error on `--version` → shown as not installed
- No agents installed → shows 0/4 available

## Not in scope

- Installing agents
- Checking agent authentication status
