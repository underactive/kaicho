# Reliability

Requirements and practices for keeping Kaicho reliable, especially given
that it depends on external AI agent CLIs that can fail unpredictably.

## Failure modes to handle

| Failure | Likelihood | Mitigation |
|---------|------------|------------|
| Agent CLI not installed | High (multi-agent) | Detect at startup, skip with warning |
| Agent times out | High | Configurable timeout per agent, default 5min |
| Agent returns malformed output | High | Output parser rejects gracefully, logs raw output |
| Agent returns empty output | Medium | Treat as "no suggestions," not an error |
| Target repo is too large | Medium | Shallow clone, file-tree filtering |
| Rate limit / auth failure | Medium | Surface the agent's error message clearly |
| Disk full (worktrees) | Low | Clean up worktrees aggressively after each run |

## Invariants

1. **Kaicho never crashes on bad agent output.** The output parser must handle
   any string without throwing. Malformed output is logged and skipped.
2. **Every run produces a result object**, even if all agents fail. The result
   contains per-agent status (success, timeout, parse-error, skipped).
3. **Worktree cleanup is guaranteed.** Use try/finally or equivalent. Leaked
   worktrees are a reliability bug.
4. **Agent invocation is idempotent.** Re-running the same prompt against the
   same repo state should be safe (may produce different suggestions, but no
   side effects).

## Testing strategy

- **Unit tests:** Output parsers are unit-tested with snapshot fixtures of
  real agent output (sanitized). One fixture per agent, per output format.
- **Integration tests:** End-to-end runs against a small fixture repo with
  at least one real agent. These are slow and run in CI, not on every save.
- **Chaos fixtures:** Deliberately malformed agent output (truncated JSON,
  mixed formats, binary garbage) to verify parser resilience.
