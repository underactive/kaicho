# Generated Schemas

JSON Schema definitions for Kaicho's core data types. These schemas are the
source of truth for data contracts between the scan, report, and future fix
phases.

## Schemas

| Schema | Description | Used by |
|--------|-------------|---------|
| [suggestion.schema.json](suggestion.schema.json) | A single finding from an agent scan | Output parser, suggestion store, dedup |
| [run-record.schema.json](run-record.schema.json) | Persisted scan result in `.kaicho/runs/` | Suggestion store, report command, future fix phase |
| [suggestion-cluster.schema.json](suggestion-cluster.schema.json) | Deduplicated group of related suggestions | Dedup engine, formatters, JSON output |
| [kaicho-config.schema.json](kaicho-config.schema.json) | Per-repo config file format | `kaicho init`, `kaicho scan` config loader |

## Key relationships

```
Suggestion (from agent)
    ↓ validated by output-parser
RunRecord (persisted to .kaicho/runs/)
    ↓ loaded by report command
SuggestionCluster (grouped by dedup engine)
    ↓ displayed by formatters
    ↓ consumed by future fix phase
```

## Note on the agent output schema

The `SUGGESTIONS_JSON_SCHEMA` in `src/prompts/shared.ts` is an OpenAI-strict
variant of `suggestion.schema.json` with `additionalProperties: false` at
every level and all fields in `required`. It is used by Codex (`--output-schema`)
and Claude (`--json-schema`) for server-side structured output enforcement.
Cursor and Gemini receive the same structure in the prompt text but without
server-side enforcement.
