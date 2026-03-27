# Spec: Configuration (kaicho init + kaicho.config.json)

**User story:** As a developer who uses Kaicho repeatedly on the same repo,
I want to set default options in a config file so I don't have to type
`--scope=src --files="*.ts" --min-severity=medium` every time.

## Acceptance criteria

- `kaicho init` creates `kaicho.config.json` in the target repo root
- `kaicho init` refuses to overwrite an existing config
- Config supports: `task`, `timeout`, `scope`, `files`, `minSeverity`, `agent`
- `kaicho scan` loads config from the target repo's `kaicho.config.json`
- CLI flags override config values
- Missing config file → no error, uses built-in defaults
- Invalid/malformed config file → warning log, uses built-in defaults

## Edge cases

- Config has unknown keys → ignored (no error)
- Config has wrong types → individual fields ignored, rest applied

## Not in scope

- Global config (~/.kaichorc)
- Config inheritance (repo config extends global)
- Config validation command
