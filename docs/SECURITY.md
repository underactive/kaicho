# Security

Kaicho runs AI agents that read and potentially modify code. Security
boundaries must be clearly defined and enforced.

## Threat model

1. **Agent output is untrusted input.** Agents may produce output that
   contains injection attempts, malicious code suggestions, or instructions
   to modify sensitive files. The output parser treats all agent output as
   untrusted strings.

2. **Target repos may contain sensitive data.** Kaicho clones or creates
   worktrees of user repos. It must not leak repo contents to unintended
   destinations. Agent invocations should use only the agent's official CLI
   — no intermediary services.

3. **Agent credentials are user-managed.** Kaicho does not store or manage
   API keys. Each agent CLI handles its own auth. Kaicho only invokes the
   CLI binary.

## Rules

- **No `eval` or dynamic code execution on agent output.** Ever.
- **No shell interpolation of agent output.** Use array-form exec, not
  string concatenation, when agent output appears near shell invocations.
- **File paths from agent output are validated** against the target repo
  root. No path traversal.
- **Suggestions are read-only by default.** Kaicho presents suggestions.
  It does not auto-apply them unless the user explicitly opts in with a
  flag like `--apply`.
- **Worktrees are disposable.** They are created in a temp directory and
  cleaned up after each run. Never modify the user's working copy.
- **No network calls from agent output.** If an agent suggests fetching
  a URL, that suggestion is displayed — not executed.

## Sensitive files

Kaicho should warn (not block) if agent suggestions touch:
- `.env`, `.env.*`
- Files matching `*secret*`, `*credential*`, `*token*`
- CI/CD configuration (`.github/workflows/`, `.gitlab-ci.yml`)
- Package lockfiles (suggest but flag for human review)
