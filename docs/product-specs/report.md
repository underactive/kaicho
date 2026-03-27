# Spec: kaicho report

**User story:** As a developer who has already run a scan, I want to re-view
and filter past results without re-running agents so I don't waste time or
API credits.

## Acceptance criteria

- Reads stored results from `.kaicho/runs/` in the target repo
- Defaults to showing the latest run per agent
- Filters by agent via `--agent=<name>`
- Filters by task type via `--task=<type>`
- Shows last N runs via `--last=<n>`
- Filters by minimum severity via `--min-severity=<level>`
- Re-clusters results using the same dedup engine as scan
- Produces human-readable or JSON output
- Expands `~` in `--repo` path

## Edge cases

- No `.kaicho/runs/` directory → error message suggesting to run scan first
- Corrupted JSON files in runs/ → silently skipped
- No matching results after filters → "No matching results found"

## Not in scope

- Diffing between runs
- Time-range filtering
