# Kaicho

Run multiple AI coding agents against your repositories and collect structured, deduplicated suggestions.

Kaicho orchestrates Claude, Codex, Cursor, and Gemini in parallel, normalizes their output into a unified format, and surfaces cross-agent agreement so you can focus on the findings that matter.

## Why

If you pay for multiple AI coding tools, most of them sit idle. Kaicho puts them all to work — run a security audit, QA review, or documentation check across all your agents at once and get a single, deduplicated report.

## Install

```bash
git clone <repo-url> && cd kaicho
npm install
npm run build
npm link
```

Requires Node.js >= 20 and at least one of:
- [Claude Code](https://claude.ai/code) (`claude`)
- [Codex CLI](https://github.com/openai/codex) (`codex`)
- [Cursor Agent](https://cursor.com/cli) (`agent`)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)

Check what you have installed:

```bash
kaicho list
```

## Quick start

```bash
# Security scan with all available agents
kaicho scan --repo=~/my-project

# Scoped scan (faster — agents only review matching files)
kaicho scan --scope=src --files="*.ts" --repo=~/my-project

# QA review
kaicho scan --task=qa --repo=~/my-project

# Documentation gaps
kaicho scan --task=docs --repo=~/my-project

# Single agent
kaicho scan --agent=codex --repo=~/my-project
```

## Commands

### `kaicho scan`

Run agents against a repository.

```
Options:
  --agent <agent>         Agent to use (omit for all available)
  --task <task>           Task: security, qa, docs (default: security)
  --repo <path>           Path to target repository (default: .)
  --timeout <ms>          Agent timeout in milliseconds (default: 300000)
  --scope <dirs>          Limit to directories (comma-separated)
  --files <patterns>      Limit to file patterns (comma-separated)
  --min-severity <level>  Filter: critical, high, medium, low, info
  --json                  JSON output (auto-enabled when piped)
```

### `kaicho report`

Re-display past scan results without re-running agents.

```
Options:
  --repo <path>           Path to target repository (default: .)
  --agent <agent>         Filter by agent
  --task <task>           Filter by task type
  --last <n>              Show last N runs (default: latest per agent)
  --min-severity <level>  Filter by minimum severity
  --json                  JSON output
```

### `kaicho list`

Show available agents and their install status.

### `kaicho init`

Create a `kaicho.config.json` in the target repository with default settings.

## Configuration

Create `kaicho.config.json` in your repo root (or run `kaicho init`):

```json
{
  "task": "security",
  "scope": "src",
  "files": "*.ts,*.js",
  "timeout": 300000,
  "minSeverity": "medium"
}
```

CLI flags override config values.

## How it works

1. **Invoke** — Kaicho spawns each agent CLI as a subprocess with structured output flags
2. **Capture** — Agent output is extracted via JSON schema enforcement (Claude, Codex) or text parsing (Cursor, Gemini)
3. **Validate** — Every suggestion is validated against a Zod schema at the boundary; malformed items are logged and dropped
4. **Cluster** — Suggestions from multiple agents are grouped by file and line proximity (within 5 lines), surfacing cross-agent agreement
5. **Store** — Results are saved to `.kaicho/runs/` as JSON for later review via `kaicho report`

## Output format

Findings are sorted by agreement count (multi-agent consensus first), then severity:

```
  [claude] 12 suggestions (147.2s)
  [codex] 6 suggestions (103.8s)
  [cursor] 5 suggestions (89.4s)
  [gemini] 5 suggestions (112.7s)

  [high] security — src/api.ts:42 3x
  agents: claude, codex, cursor
    claude: User input concatenated into SQL query...
    codex: SQL injection via string interpolation...
    cursor: Unsanitized input in database query...

  20 findings (5 confirmed by multiple agents) from 4 agents (147.2s)
```

## Architecture

```
CLI → Orchestrator → Agent Adapters (Claude, Codex, Cursor, Gemini)
                         ↓
                   Output Parser (Zod validation)
                         ↓
                   Suggestion Store (.kaicho/runs/)
                         ↓
                   Dedup Engine (clustering)
                         ↓
                   Formatters (human / JSON)
```

Built with TypeScript (strict mode), Zod, Commander, and Execa. Three production dependencies.

## License

MIT
