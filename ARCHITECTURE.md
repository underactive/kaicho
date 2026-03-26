# Kaicho Architecture

## System overview

Kaicho orchestrates multiple AI coding agents (Claude, Codex, Gemini, Cursor)
against target repositories and collects their output as structured suggestions.

```
┌─────────────────────────────────────────────────────────┐
│                      CLI / API                          │
│  (user invokes a run against a repo)                    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   Orchestrator                          │
│  Resolves agent config, prepares repo context,          │
│  dispatches work to agent adapters                      │
└──────────┬──────────────────────────────────┬───────────┘
           │                                  │
           ▼                                  ▼
┌─────────────────────┐          ┌─────────────────────┐
│   Agent Adapters    │          │   Repo Context       │
│  ┌───────────────┐  │          │  Provider            │
│  │ Claude CLI    │  │          │  (clones, worktrees, │
│  │ Codex CLI     │  │          │   file tree, diffs)  │
│  │ Gemini CLI    │  │          └─────────────────────┘
│  │ Cursor agent  │  │
│  └───────────────┘  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│                  Output Parser                          │
│  Normalizes raw agent output into structured            │
│  Suggestion objects (file, line, category, rationale)   │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                Suggestion Store                         │
│  Persists, deduplicates, and indexes suggestions        │
│  across runs and agents                                 │
└─────────────────────────────────────────────────────────┘
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

| Domain            | Purpose                                           | Status    |
|-------------------|---------------------------------------------------|-----------|
| `agent-adapters`  | Uniform interface to each AI agent CLI            | Planned   |
| `repo-context`    | Clone, worktree, file-tree, diff extraction       | Planned   |
| `output-parser`   | Raw agent stdout -> structured Suggestion objects | Planned   |
| `suggestion-store`| Persist, dedupe, index suggestions across runs    | Planned   |
| `orchestrator`    | Dispatch runs, manage lifecycle, retry/timeout    | Planned   |
| `cli`             | User-facing CLI commands and flags                | Planned   |

## Key design decisions

1. **Adapter pattern for agents.** Each agent (Claude, Codex, Gemini, Cursor)
   gets a uniform adapter behind a shared interface. This isolates their
   wildly different output formats and invocation methods.

2. **Structured suggestions as the core data type.** Every agent's output is
   normalized into `Suggestion` objects with: `file`, `line`, `category`,
   `severity`, `rationale`, `suggestedChange`. This is what makes cross-agent
   comparison possible.

3. **Repo context is ephemeral.** Each run gets a worktree or shallow clone.
   Agents operate on isolated copies. Cleanup is automatic.

4. **Parse at the boundary.** Agent output is untrusted. The output parser
   validates and structures it. Interior code works only with typed,
   validated `Suggestion` objects.

5. **Boring tech.** TypeScript, Node.js, SQLite for local persistence. No
   exotic dependencies. Agents reason better about well-known tools.
