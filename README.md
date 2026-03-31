# Kaicho

Run multiple AI coding agents against your repositories, collect structured suggestions, and apply fixes — all from one CLI.

Kaicho orchestrates Claude, Codex, Cursor, and Gemini in parallel, normalizes their output, deduplicates across agents, and lets you fix issues on isolated git branches.

## Why

If you pay for multiple AI coding tools, most of them sit idle. Kaichō puts them all to work — run security audits, QA reviews, interface contract checks, state management analysis, and more across all your agents at once. Get a single deduplicated report with LLM-generated summaries, then apply fixes in parallel on isolated git branches.

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

Optional: [Ollama](https://ollama.ai) with `gemma3:1b` for local LLM summaries.

Check what you have installed:

```bash
kaicho list
```

## Quick start

```bash
# 1. Scan — run all agents in parallel
kaicho scan --repo=~/my-project

# 2. Review — see deduplicated, summarized findings
kaicho report --repo=~/my-project

# 3. Fix — apply fixes on an isolated branch
kaicho fix --repo=~/my-project

# Or batch fix in parallel (3 agents at once, independent branches)
kaicho fix --batch --repo=~/my-project

# With cross-agent validation
kaicho fix --batch --validate --repo=~/my-project
```

## Commands

### `kaicho scan`

Run agents against a repository. All installed agents run in parallel.

Available tasks: `security`, `qa`, `docs`, `contracts`, `state`, `resources`, `testing`, `dx`, `performance`, `resilience`, `logging`

```
Options:
  --agents <agents>       Agents to run (comma-separated, default: all available)
  --exclude <agents>      Exclude agents (comma-separated)
  --task <task>           Task type (default: security)
  --repo <path>           Path to target repository (default: .)
  --timeout <ms>          Agent timeout in milliseconds (default: 1800000)
  --scope <dirs>          Limit to directories (comma-separated)
  --files <patterns>      Limit to file patterns (comma-separated)
  --min-severity <level>  Filter: critical, high, medium, low, info
  --json                  JSON output (auto-enabled when piped)
  --verbose               Show detailed output
  --debug                 Show raw agent output
```

### `kaicho fix`

Apply fixes for scan findings using AI agents on isolated git branches.

```
Options:
  --repo <path>           Path to target repository (default: .)
  --agent <agent>         Agent to use for fixing (default: agent that found the issue)
  --id <hash>             Fix a specific finding by short ID
  --cluster <n>           Fix by cluster number
  --task <task>           Filter findings by task type
  --timeout <ms>          Agent timeout in milliseconds (default: 1800000)
  --min-severity <level>  Minimum severity to fix
  --validate              Run a second agent to review each fix
  --reviewer <agent>      Agent for validation (default: auto-pick different from fixer)
  --batch                 Fix in parallel with git worktrees (keep/discard/retry per fix)
  --auto                  Batch fix without confirmations (auto-discard concerns)
  --verbose               Show agent stderr output in real-time
```

### `kaicho sweep`

Run a layered, multi-round scan-fix-verify loop across all task types. Scans in priority order (security → qa → contracts/state → resources/resilience → performance → logging → testing/docs/dx), fixes findings at each layer, and checks for regressions before advancing.

```
Options:
  --repo <path>           Path to target repository (default: .)
  --auto                  Fix without confirmations
  --max-rounds <n>        Maximum sweep rounds (default: 3)
  --agents <agents>       Agents to use (comma-separated)
  --exclude <agents>      Exclude agents
  --timeout <ms>          Agent timeout (default: 1800000)
  --validate              Cross-agent validation on fixes
  --reviewer <agent>      Reviewer agent for validation
  --concurrency <n>       Parallel fix concurrency (default: 3)
  --final-scan            Run a full re-scan after all rounds to report remaining findings
  --verbose               Show detailed output
```

Exits when zero critical/high findings remain in security + qa, or after max rounds. Writes `.kaicho/sweep-report.json` and `.kaicho/sweep-regressions.json`. All output is automatically logged to `.kaicho/sweep-<timestamp>.log`.

### `kaicho report`

Re-display past scan results without re-running agents.

```
Options:
  --repo <path>           Path to target repository (default: .)
  --agent <agent>         Filter by agent
  --task <task>           Filter by task type
  --id <hash>             Show full detail for a specific finding
  --last <n>              Show last N runs (default: latest per agent)
  --min-severity <level>  Filter by minimum severity
  --json                  JSON output
  --verbose               Show detailed output
```

### `kaicho enrich`

Generate LLM summaries for findings using a local Ollama model.

```
Options:
  --repo <path>           Path to target repository (default: .)
  --task <task>           Filter by task type
  --model <model>         Ollama model (default: gemma3:1b)
  --force                 Regenerate even if cache exists
```

### `kaicho list`

Show available agents and their install status.

### `kaicho init`

Create a `kaicho.config.json` in the target repository.

## Configuration

Global config at `~/.config/kaicho/config.json` applies to all repos. Per-repo `kaicho.config.json` overrides global. CLI flags override both.

```
global defaults → ~/.config/kaicho/config.json → repo/kaicho.config.json → CLI flags
```

Create per-repo config with `kaicho init`, or create the global config manually:

```json
{
  "task": "security",
  "scope": "src",
  "files": "*.ts,*.js",
  "timeout": 1800000,
  "minSeverity": "medium",
  "models": {
    "codex": "o4-mini",
    "gemini": "gemini-2.5-pro"
  },
  "fixModels": {
    "claude": "claude-opus-4-6",
    "codex": "o3"
  },
  "reviewer": "claude",
  "concurrency": 3,
  "retention": 3,
  "summarizerModel": "gemma3:1b",
  "maxSweepRounds": 3
}
```

CLI flags override config values.

## How it works

1. **Scan** — Fingerprints the target repo (language, framework, test runner, linters, etc.) and injects best-effort project context into the prompt. In monorepos, workspace packages are resolved and fingerprinted individually. Spawns each agent CLI as a subprocess. Agents run in parallel.
2. **Parse** — Agent output is extracted from freeform text via multi-strategy parsing (direct JSON, code fences, brace extraction). Field names are normalized to handle LLM drift. Every suggestion is validated with Zod.
3. **Cluster** — Suggestions are grouped by file + line proximity (±5 lines), then merged by rationale keyword similarity. Cross-agent agreement surfaces first.
4. **Enrich** — If Ollama is running, each cluster gets a one-line LLM summary. Cached per-task.
5. **Store** — Results saved to `.kaicho/runs/` as JSON. Enrichment cached in `.kaicho/enriched-*.json`.
6. **Fix** — Agent dispatched with write-access flags on an isolated `kaicho/fix-*` branch. Batch mode uses git worktrees for parallel execution (up to 3 concurrent). Each fix gets its own branch — keep or discard independently. Optional cross-agent validation runs in parallel with fixes. Discarded fixes are logged with full context (diff, fixer reasoning, reviewer rationale) for future review.

## Output

Findings are sorted by agreement (multi-agent consensus first), then severity:

```
  [claude] 12 suggestions (147.2s)
  [codex] 6 suggestions (103.8s)
  [cursor] 5 suggestions (89.4s)

  ecb5a3 [high] security — src/api.ts:42 3x
      SQL injection via unsanitized user input in query builder
  agents: claude, codex, cursor
    claude: User input concatenated into SQL query...
    codex: SQL injection via string interpolation...
    cursor: Unsanitized input in database query...
    > Use parameterized queries instead of string concatenation

  20 findings (5 confirmed by multiple agents) from 3 agents (147.2s)
```

Fixed findings show `[fixed]` in reports. Already-fixed findings are skipped by `kaicho fix`.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full domain diagram and design decisions.

Built with TypeScript (strict mode), Zod, Commander, and Execa. Three production dependencies.

## License

MIT
