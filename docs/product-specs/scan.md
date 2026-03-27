# Spec: kaicho scan

**User story:** As a developer with multiple AI coding tool subscriptions,
I want to run all my agents against a repository in parallel and get a single
deduplicated report so I can find issues faster and with higher confidence.

## Acceptance criteria

- Invokes all installed agents in parallel when `--agent` is omitted
- Invokes a single agent when `--agent=<name>` is specified
- Supports task types: `security`, `qa`, `docs` via `--task`
- Defaults to `security` task when `--task` is omitted
- Scopes agent focus to specific directories via `--scope=<dirs>`
- Scopes agent focus to file patterns via `--files=<patterns>`
- Filters output by minimum severity via `--min-severity=<level>`
- Stores results to `.kaicho/runs/` in the target repo
- Produces human-readable clustered output in TTY mode
- Produces JSON output when piped or `--json` is passed
- Clusters suggestions by file + line proximity (±5 lines)
- Multi-agent agreement surfaces first in output
- Loads defaults from `kaicho.config.json` if present; CLI flags override
- Exits 0 if any agent succeeds, 1 if all fail
- Expands `~` in `--repo` path

## Edge cases

- Agent CLI not installed → status: "skipped", continues with others
- Agent times out → status: "timeout", does not block other agents
- Agent returns malformed output → status: "parse-error", partial valid
  suggestions are kept
- Agent returns empty output → status: "success" with 0 suggestions
- No agents installed → all skipped, exit 1
- Unknown task name → error with list of available tasks
- `--scope` matches no files → agents told "no files match"

## Not in scope

- Auto-applying suggestions (future `kaicho fix` command)
- Interactive approval of suggestions
- Agent-to-agent communication or chaining
