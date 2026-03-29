# Kaicho Architecture

## System overview

Kaicho orchestrates multiple AI coding agents (Claude, Codex, Gemini, Cursor)
against target repositories, collects their output as structured suggestions,
deduplicates across agents, and can dispatch agents to apply fixes.

```
┌─────────────────────────────────────────────────────────┐
│                      CLI                                │
│  scan, fix, report, enrich, list, init                  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   Orchestrator                          │
│  run-scan: parallel agents + scope + auto-enrich        │
│  run-fix: single fix on isolated branch                 │
│  run-parallel-fix: worktree per fix, up to 3 concurrent │
│  run-sweep: layered multi-round scan-fix-verify loop    │
└──────────┬──────────────────────────────────┬───────────┘
           │                                  │
           ▼                                  ▼
┌─────────────────────┐          ┌─────────────────────┐
│   Agent Adapters    │          │   Scope Resolver     │
│  ┌───────────────┐  │          │  (git ls-files,      │
│  │ Claude CLI    │  │          │   glob filtering)    │
│  │ Codex CLI     │  │          └─────────────────────┘
│  │ Gemini CLI    │  │
│  │ Cursor agent  │  │          ┌─────────────────────┐
│  └───────────────┘  │          │   Branch Manager     │
│  scan | fix | review │          │  (create, diff,      │
└──────────┬──────────┘          │   commit, worktree)  │
           │                     └─────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────┐
│                  Output Parser                          │
│  parseFromFile (schema-enforced: Claude, Codex)         │
│  parseFromText (freeform: Cursor, Gemini)               │
│  parseFromJsonl (Codex JSONL fallback)                  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Dedup + Clustering                         │
│  Line proximity → rationale fingerprint → Jaccard       │
│  similarity. Short IDs, severity filter.                │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌──────────────────────┴──────────────────────────────────┐
│  Suggestion Store       │  Summarizer       │  Fix Log       │
│  .kaicho/runs/*.json    │  Ollama (local)   │  fixed.json    │
│  RunRecord per agent    │  enriched-*.json  │  discarded.json│
└─────────────────────────┴───────────────────┴───────────┘
```

## Domain layers

Within each domain, code flows in one direction only:

```
Types → Config → Repository → Service → Runtime → UI (if applicable)
```

| Layer        | Responsibility                                    | May depend on        |
|--------------|---------------------------------------------------|----------------------|
| **Types**    | Shared interfaces, enums, schemas                 | Nothing              |
| **Config**   | Environment, feature flags, agent configuration   | Types                |
| **Repository** | Data access, file I/O, persistence              | Types, Config        |
| **Service**  | Business logic, orchestration, parsing            | Types, Config, Repo  |
| **Runtime**  | CLI entry points, HTTP handlers, process lifecycle | All above            |
| **UI**       | Terminal output, formatting, interactive prompts  | All above            |

Cross-cutting concerns (logging, telemetry, error handling) are injected via a
single **Providers** interface. Domains never import cross-cutting code directly.

## Domains

| Domain            | Purpose                                           | Status      |
|-------------------|---------------------------------------------------|-------------|
| `types`           | Suggestion, AgentAdapter, RunResult, AgentMode    | Implemented |
| `config`          | Defaults, agent registry, kaicho.config.json      | Implemented |
| `agent-adapters`  | Uniform interface to 4 AI agent CLIs              | Implemented |
| `output-parser`   | Raw agent stdout → structured Suggestion objects  | Implemented |
| `suggestion-store`| Persist RunRecords to .kaicho/runs/               | Implemented |
| `dedup`           | Cluster, merge, filter suggestions across agents  | Implemented |
| `scope`           | File list resolution via git ls-files + globs     | Implemented |
| `orchestrator`    | Scan, fix, parallel-fix, validation, retry, sweep | Implemented |
| `branch`          | Git branch + worktree lifecycle for fixes          | Implemented |
| `fix-log`         | Track applied + discarded fixes, self-pruning      | Implemented |
| `summarizer`      | Ollama integration for LLM summaries              | Implemented |
| `prompts`         | 11 scan tasks + fix/retry/validate prompts         | Implemented |
| `logger`          | Structured JSON logging to stderr                 | Implemented |
| `cli`             | 7 commands, 2 formatters, progress callbacks      | Implemented |
| `repo-context`    | Project metadata fingerprinting for prompt enrichment | Implemented |

## Key design decisions

1. **Adapter pattern for agents.** Each agent (Claude, Codex, Gemini, Cursor)
   gets a uniform adapter behind a shared interface. This isolates their
   wildly different output formats and invocation methods.

2. **Structured suggestions as the core data type.** Every agent's output is
   normalized into `Suggestion` objects with: `file`, `line`, `category`,
   `severity`, `rationale`, `suggestedChange`. This is what makes cross-agent
   comparison possible.

3. **AgentMode: scan vs fix.** Same adapter, different CLI flags. Scan uses
   read-only modes; fix uses write-access modes. No code duplication.

4. **Parse at the boundary.** Agent output is untrusted. The output parser
   validates and structures it. Interior code works only with typed,
   validated `Suggestion` objects.

5. **Two-pass deduplication.** Line proximity clustering (±5 lines), then
   Jaccard keyword similarity for same-file same-category clusters that
   differ in wording but describe the same issue.

6. **Fix on isolated branches.** Fixes never touch the user's working branch.
   Single fix creates one branch. Batch fix creates a worktree + branch per
   fix (up to 3 concurrent), user merges individually.

7. **Self-pruning fix log.** Tracks which findings are fixed and which were
   discarded (with full context: diff, fixer reasoning, reviewer rationale).
   Auto-removes entries when branches are deleted or after 30 days.

8. **Boring tech.** TypeScript, Node.js, JSON file persistence. Three
   production dependencies (zod, commander, execa). Agents reason better
   about well-known tools.
