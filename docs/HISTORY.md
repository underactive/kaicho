# Kaicho — Project History

149 commits. 10 days. One developer. 16,500 lines of TypeScript across 112 files.
481 tests. 5 AI coding agents wired together into a single orchestrator.

This document traces Kaicho from its first commit to the present, organized
by the major phases of development.

---

## Timeline at a glance

| Date | Phase | Milestone |
|------|-------|-----------|
| Mar 26 12:52 | Phase 0 | First commit — Codex adapter + security scan |
| Mar 26 18:16 | Fix Phase A | Single interactive fix command |
| Mar 26 20:15 | Fix Phase B | Batch fix on one branch |
| Mar 27 05:51 | Fix Phase C | Cross-agent validation + conflict detection |
| Mar 27 13:28 | Fix+ | Retry with reviewer context, verbose mode |
| Mar 27 14:36 | Worktrees | Parallel fix via git worktrees |
| Mar 27 19:41 | 8 tasks | contracts, state, resources, testing, dx |
| Mar 27 20:36 | Config | fixModels, global config, reviewer pool |
| Mar 28 14:39 | Variants | Agent variants (same CLI, different models) |
| Mar 28 20:08 | Repo context | Fingerprint repos to enrich all prompts |
| Mar 28 21:07 | 11 tasks | performance, resilience, logging |
| Mar 28 21:39 | Sweep | Multi-round layered scan-fix-verify loop |
| Mar 29 00:54 | Batched fix | File-disjoint execution with informed grouping |
| Mar 29 | Sweep hardening | Worktree isolation, squash merge, progress reporting |
| Mar 30 | Robustness | Regression flag-and-continue, parse normalization |
| Mar 31 | Freeform parsing | Drop structured output, FP filtering, two-pass sweep |
| Apr 1  | Dashboard & SQLite | Web dashboard, OpenCode adapter, SQLite storage |
| Apr 2–3 | OpenRouter | Remote summarizer, reviewer pool rename |
| Apr 5  | 0.1.1 | Patch release — dashboard polish, 149 commits |

---

## Phase 0 — The core loop (Mar 26, afternoon)

**Commits:** `ee68b1a` → `4c9b8e4` (12 commits)

The entire foundation was laid in a single afternoon session. The goal was
simple: invoke an AI coding agent against a repo and capture its output as
structured suggestions.

### First commit: Codex adapter + security scan (`ee68b1a`)

Everything started with OpenAI Codex. A single adapter that shells out to
`codex-cli`, captures stdout/stderr, parses the output into a `Suggestion[]`
array, and writes a `RunRecord` to `.kaicho/runs/`. The security scan prompt
was the first (and only) task.

### Multi-agent orchestration (`657f457`)

The second commit added Claude, Cursor, and Gemini adapters — each with its
own CLI invocation pattern and output parser. The orchestrator runs all
available agents in parallel via `Promise.allSettled` and merges their
results. This established Kaicho's core identity: it's not an agent, it's an
**agent orchestrator**.

### Cross-agent dedup (`d66d907`)

When multiple agents scan the same repo, they find the same issues. This
commit introduced suggestion clustering — group findings by file + line
proximity across agents. A cluster with agreement from 3/4 agents is more
trustworthy than a solo finding. This became the `SuggestionCluster` type
that the entire system revolves around.

### Rapid feature fill-in (`8112f56` → `4c9b8e4`)

The remaining Phase 0 commits filled out the CLI surface:
- `--scope` and `--files` flags for targeted scans
- `~` expansion in `--repo` path (the kind of fix you make after using it once)
- `kaicho report` command to view past scan results
- `--task=qa` and `--task=docs` scan tasks (3 total)
- `--min-severity` filter
- `kaicho list` to show installed agents
- `kaicho.config.json` + `kaicho init`

### Documentation wave (`875f7c0` → `953f9d7`)

Phase 0 closed with a burst of documentation: README, architecture overview,
execution plans, product specs, quality scores, and JSON schemas. The agent
workflow in `AGENTS.md` was established here — the rule that complex work
requires an execution plan before implementation.

---

## Fix Phase A — Interactive single fix (Mar 26, evening)

**Commits:** `3b76695` → `3c4954d`

An execution plan was written first (`3b76695`), then the fix command landed
in one commit (`3c4954d`). The flow: pick a cluster from scan results, send
it to an agent with a fix prompt, apply the diff, commit with a descriptive
message. Interactive confirmation before each fix.

---

## The enrichment detour (Mar 26, 7–8 PM)

**Commits:** `c5f56b2` → `e98f5a0` (10 commits)

This was the most chaotic stretch of the project — 10 commits in 2 hours,
including a revert. The goal was to add Ollama-powered summaries to make
scan results more readable.

- **Short IDs** (`c5f56b2`): Cluster IDs went from full hashes to 4 hex chars.
- **ID collision fix** (`b6f3601`): 4 hex chars wasn't enough. Bumped to 6.
  *Rationale: With 50+ clusters per scan, birthday-problem collisions were
  hitting in real repos.*
- **Dedup pass 2** (`d6a0417`): Merged clusters that were far apart in line
  number but had similar rationale text. *Rationale: Agents often report the
  same class of issue at multiple locations — e.g., "missing input
  validation" at every API handler.*
- **Cache key fix** (`fa8052b`): Enrichment cache was keyed by file path, but
  multiple clusters can exist in one file. Switched to cluster ID.
- **Summary in fix → reverted** (`e9fa847` → `a0e7b73`): Tried showing the
  Ollama summary in the fix confirmation prompt, reverted 2 minutes later.
  *Rationale: The summary added noise to an already information-dense
  confirmation screen. The cluster ID was enough for the user to cross-
  reference.*
- **Jaccard similarity** (`e98f5a0`): Replaced the dedup's simple rationale
  comparison with Jaccard keyword similarity, catching more duplicates across
  differently-worded agent outputs.

---

## Fix Phase B — Batch mode (Mar 26, late evening)

**Commit:** `054e3b0`

Instead of fixing one cluster at a time, `kaicho fix --batch` applies all
findings on a single branch. The fix log (`656b9b7`) was added right after to
track what was already fixed, so re-runs skip completed work.

### Operational fixes (`4350b58` → `5f22436`)

- Default timeout bumped from 5 → 10 minutes. *Rationale: Complex fixes in
  large repos were hitting the 5-minute wall.*
- Auto-enrichment persistence (`9798a8a`): Summaries generated during scan
  weren't being saved. Users had to re-enrich manually.
- Codex `--ephemeral` flag removed (`51799a0`): The flag was causing Codex to
  lose context between invocations.
- Descriptive commit messages (`58d229d`): Fix commits went from generic
  "kaicho fix" to including the finding description.
- Fixed findings marked in report output (`5f22436`): So `kaicho report`
  shows what's already been addressed.

---

## Model configuration + testing (Mar 26 night → Mar 27 morning)

**Commits:** `4e0934e` → `5f2e4ba`

Per-agent model overrides via `kaicho.config.json` landed here. The config
shape: `models: { claude: "sonnet", codex: "o3" }`. This was followed by a
dedicated testing push — 76 tests grew to 115.

---

## Fix Phase C — Validation (Mar 27, early morning)

**Commits:** `5e59a3b` → `074160d`

The third fix phase added cross-agent validation: after one agent applies a
fix, a different agent reviews it. Execution plan first, then implementation,
then plan moved to completed — the pattern was becoming routine.

### Reviewer flag (`b91d51c`)

`--reviewer` lets you pick which agent validates. Default is Claude (the
agent least likely to rubber-stamp).

### Agent selection flags (`53a702f` → `edec3bd`)

`--agents` and `--exclude` for scan agent selection. The `--agent` singular
flag was immediately refactored to `--agents` plural the next commit.
*Rationale: Users want to say "everything except Cursor" or "just Claude
and Codex", not pick one at a time.*

---

## Housekeeping and config (Mar 27, morning–afternoon)

**Commits:** `db6c4c2` → `38321aa`

- **Auto-prune** (`db6c4c2`): Old scan runs cleaned up automatically.
  `.kaicho/runs/` was growing unbounded.
- **gemma3:1b** (`7634fea`): Default summarizer switched from larger Ollama
  model to gemma3:1b. *Rationale: Summaries don't need a large model —
  they're one-sentence descriptions of code findings.*
- **`.gitignore` auto-update** (`3d49fa2`): `kaicho init` adds `.kaicho/`
  to `.gitignore` if the file exists.
- **Review agent mode** (`38321aa`): Validation agents now run in read-only
  mode — no file writes, no schema enforcement. *Rationale: A reviewer that
  can modify files defeats the purpose of independent review.*

---

## Fix Phase D — Retry + reviewer context (Mar 27, afternoon)

**Commits:** `1910f44` → `304293f`

When a reviewer flags a concern, the fixer can now retry with the reviewer's
feedback injected into the prompt. The fixer sees what was wrong and tries
again. Timeout bumped to 30 minutes for complex retry loops.

### Commit signature (`d72091d`)

Fixes now carry a Kaichō commit signature: which agent found the issue, which
agent fixed it, which agent reviewed it. This is provenance metadata — when
you're reading `git blame` 6 months later, you know exactly which AI pipeline
produced each change.

---

## Parallel fix with worktrees (Mar 27, afternoon)

**Commits:** `8357c76` → `f15cd22`

The biggest architectural shift in the fix pipeline. Instead of applying fixes
sequentially on one branch, each fix gets its own git worktree — an
independent working copy branched from the same base. Fixes run in parallel
(up to 3 concurrent).

- **Parallel validation** (`7e30afd`): Validation runs concurrently with the
  fix, not after it. While fix N is being applied, fix N-1 is being reviewed.
- **Discarded fix log** (`f15cd22`): Fixes the user rejects are logged with
  full context (diff, rationale, reviewer verdict). *Rationale: A discarded
  fix is still useful data — it tells future agents "this was tried and
  rejected."*

---

## Expanding scan coverage (Mar 27, evening)

**Commits:** `e379c35` → `e5b8ee2`

Five new scan tasks in rapid succession:
1. **contracts** — interface contract violations (API shape drift, schema mismatches)
2. **state** — state management issues (race conditions, stale closures, global mutation)
3. **resources** — concurrency and resource lifecycle (leaks, unbounded pools)
4. **testing** — test coverage gaps and antipatterns
5. **dx** — developer experience (dead code, confusing naming, missing types)

Each prompt was designed with explicit "skip if covered by" sections to prevent
overlap with existing tasks. The original security, qa, and docs prompts were
updated in the same session (`e5b8ee2`).

---

## The config refinement arc (Mar 27, evening–night)

**Commits:** `186e0f1` → `306a854` (12 commits in 3 hours)

This was the second chaotic stretch. The user was actively using Kaicho
against real repos and hitting config edge cases:

- **fixModels** (`186e0f1`): Separate model config for fix vs scan. You might
  want a cheaper model for scanning but a stronger one for fixing.
- **JSON extraction fix** (`cab266c`): Reviewer verdicts were failing to parse
  when the agent output contained nested braces. Switched to brace-depth
  counting. *Rationale: Regex-based JSON extraction breaks on real agent
  output that includes code samples with braces.*
- **Model name in commit** (`0614794`): Commit signatures now include which
  model was used, not just which agent.
- **Global config** (`31612c3`): `~/.config/kaicho/config.json` for
  machine-wide defaults. Per-repo config overrides global.
- **Reviewer pool** (`f35eeda`): `reviewer: "claude,gemini"` picks randomly
  from the list. *Rationale: Diverse reviewers catch different things. A
  single reviewer develops blind spots.*
- **Found-by line fix** (`be3d507`): Commit metadata was incorrectly showing
  fix models in the "Found by" line instead of scan models.
- **Empty config override bug** (`f9d2b17`): `models: {}` in per-repo config
  was clobbering global config instead of falling through.
- **Init template → reverted → simplified** (`a486a35` → `306a854` →
  `e6f9b24`): Tried slimming down `kaicho init` output to avoid overriding
  global config, reverted within 2 minutes (the slim template was *too* slim —
  it removed fields users need to see), then landed a simpler fix: just update
  the timeout default.

### Commit signature finalization (`5dbb193` → `31b276f`)

Three commits to get the commit signature format right:
- Include reviewer name and model (`5dbb193`)
- Reformat to "Fixed by X and reviewed by Y, applied via Kaichō" (`274e395`)
- Capitalize agent names in rationale lines (`31b276f`)

*Rationale: The commit signature is the most visible output of the entire
system. Getting it right matters for trust and auditability.*

---

## Agent variants (Mar 28, afternoon)

**Commit:** `8d95513`

A single agent CLI (e.g., `claude`) can now run with different models as
distinct "variants." `claude:haiku` and `claude:opus` are treated as separate
agents in scan results and agreement counting. This multiplied effective agent
count without requiring new adapter code.

---

## Repo context — fingerprinting (Mar 28, evening)

**Commits:** `ffd76b1` → `f57ba01`

A new `repo-context` domain that reads signal files (package.json, go.mod,
Cargo.toml, tsconfig.json, lockfiles, linter configs) and injects a
"best-effort repo-level hints" block into every prompt. Agents now know the
target repo's language, framework, test runner, and linters before they start.

- **Core fingerprinting** (`ffd76b1`): `RepoContext` type with `DetectedSignal`
  entries carrying both name and source file.
- **Threaded into all prompts** (`0350bc3`): Not just scans — fix, retry, and
  validation prompts all get repo context now.
- **Monorepo support** (`54c168b`): Workspace packages detected via
  npm/pnpm/lerna/cargo workspace configs. Glob patterns resolved without a
  glob dependency (simple `dir/*` via `fs.readdir`).

---

## 11 scan tasks (Mar 28, late evening)

**Commit:** `cb44bcd`

Three final scan tasks added:
- **performance** — N+1 queries, blocking I/O, algorithmic complexity
- **resilience** — timeouts, circuit breakers, graceful shutdown
- **logging** — PII in logs, structured logging, correlation IDs

A `SCAN_TASKS` registry was introduced as the single source of truth for all
11 task names, preventing drift across CLI, orchestrator, schemas, and docs.

---

## Sweep — the full loop (Mar 28, late night)

**Commit:** `c0801bb`

`kaicho sweep` is the capstone feature: a multi-round, priority-ordered loop
that scans all 11 tasks, fixes findings, and checks for regressions.

### Design decisions

- **7 layers, priority-ordered**: security → qa → contracts/state →
  resources/resilience → performance → logging → testing/docs/dx. Higher
  layers fix first because lower layers depend on them (you can't optimize
  performance if there's a security hole).
- **Regression detection**: After fixing layer N, re-scan layer N-1. If
  critical/high findings increased, revert all layer N fixes. A performance
  optimization that breaks a security check gets rolled back automatically.
- **Exit condition**: Zero critical/high findings in security + qa. Medium/low
  findings are acceptable — the sweep doesn't chase perfection.
- **Multi-round**: Up to 3 rounds (configurable). Each round re-scans
  everything, because fixes in round 1 may uncover new issues.

---

## File-disjoint batched execution (Mar 29, early morning)

**Commit:** `6b238df`

The final (so far) architectural change. Parallel worktree fixes had a
fundamental problem: when two fixes touch overlapping files, they create merge
conflicts. In auto mode, there's no human to resolve them.

The solution: **file-disjoint batching with informed grouping**.

- Fixes are grouped into batches where no two fixes in the same batch target
  the same file.
- After each batch merges, the system discovers which files were *actually*
  changed (via `git diff --name-only`) — not just the cluster's primary file.
- Subsequent batches defer any cluster that targets a file already touched.

This replaced `runParallelFix` as the public API for both `kaicho fix --batch`
and `kaicho sweep`.

---

## Sweep hardening (Mar 29)

**Commits:** `e7c23a0` → `1325b02` (13 commits)

With the sweep loop live, real-world usage against production repos exposed
a wave of reliability issues. This was a stabilization push.

### Squash merge & fingerprinting (`e7c23a0`)

Fix branches switched from regular merge to squash merge, producing cleaner
history. Per-component fingerprinting landed in the same commit — in monorepos,
each workspace package now gets its own `RepoContext` block in the prompt.
Language detection expanded to cover Python, Rust, Go, Java, C/C++, and more.

### Sweep worktree isolation (`818b669`, `c97729e`)

Sweeps now run in a dedicated git worktree, protecting the user's working tree
from in-progress fix branches. *Rationale: Users were unable to do other work
in the repo while a multi-hour sweep was running.*

### Progress reporting (`d70f3e9`)

Global fix progress events (per-cluster start/pass/fail/skip) for both sweep
and batched fix, replacing the previous per-batch-only progress.

### Regression handling (`82cfd54`, `93d50f9`)

Auto-revert on regression was replaced with flag-and-continue. Layer tags
(`kaicho/layer-<name>`) mark the sweep branch after each layer, enabling
selective manual revert without losing all progress. *Rationale: Auto-revert
was too aggressive — it discarded valid fixes when an agent introduced a
single new finding.*

---

## Parse boundary hardening (Mar 30)

**Commits:** `49d7581` → `46e04df` (6 commits)

Agents invent their own category and severity labels. This batch normalized
everything at the parse boundary:

- Capitalized values (`"High"`, `"SECURITY"`) lowercased
- Agent-invented categories (`"vulnerability"`, `"error-handling"`) mapped
  to valid enum values
- Unknown categories mapped to `bug` instead of being rejected
- Model specifiers stripped from agent display names in commit messages

---

## Freeform parsing & prompt refinement (Mar 31)

**Commits:** `57a6d07` → `535778a` (22 commits)

The biggest single-day push since Phase 0. Two major architectural changes
plus a wave of sweep operational fixes.

### Serial-phase batching (`57a6d07`)

When multiple clusters target the same file, they're now grouped into a single
agent session instead of sequential separate invocations. The agent sees all
findings at once and applies a coherent fix. *Rationale: Sequential same-file
fixes caused cascading merge conflicts as line numbers shifted.*

### Freeform parsing (`4510c46`)

Dropped `--json-schema` and structured output enforcement from all adapters.
Every agent now returns freeform text, parsed post-hoc via multi-strategy
extraction (direct JSON → code fences → brace extraction). This was the
biggest reliability win of the project — structured output modes were silently
failing across agents, especially with larger models.

### FP filtering & confidence gating (`f5c6e1d`)

All 11 scan prompts gained:
- An explicit exclusions list (DoS, test files, ReDoS on trusted input, etc.)
- A confidence gate (80% threshold)
- A phased analysis methodology (understand context → compare patterns → assess impact)

### Two-pass sweep (`535778a`)

`--two-pass` flag: first pass speed-runs all layers, second pass does a
thorough security + QA re-scan. *Rationale: The single-pass approach spent too
long on low-priority layers before catching critical regressions.*

### Cursor file-lock serialization (`f74a6ac`, `e905a02`)

Same-CLI agent variants (e.g., `cursor:composer-1` and `cursor:composer-2`)
now run sequentially via a shared promise chain. The Cursor CLI writes a global
`~/.cursor/cli-config.json` at startup — parallel invocations caused file-lock
races and corrupted configs.

### Claude reformat retry (`2607a34`)

When a Claude scan returns prose instead of JSON, the adapter now makes a
second call asking Claude to extract and reformat the findings. This catches
the common case where Claude produces a valid analysis but wraps it in markdown
instead of raw JSON.

---

## Dashboard, OpenCode & SQLite (Apr 1)

**Commits:** `cbaaa03` → `807ab67` (16 commits)

### Web dashboard (`c75bd5c`)

A `@kaicho/dashboard` workspace package providing a local web UI for browsing
scan results, fix logs, and discarded fix rationale. Built as a SPA served
from the CLI.

### OpenCode adapter (`860ca58`)

Fifth agent adapter. OpenCode CLI provides access to free-tier models via
OpenRouter, expanding the agent pool without additional API costs. Model names
with a `/` prefix (e.g., `openrouter/qwen/qwen3-coder:free`) pass through
as-is; bare names get an `opencode/` prefix.

### SQLite storage (`fba786c`)

Replaced the per-run JSON file storage with SQLite. Scan results, fix logs,
and enrichment data now live in `.kaicho/kaicho.db`. Added an agent severity
distribution chart to the dashboard. *Rationale: JSON files were O(n) for
lookups and growing unwieldy with 100+ scan runs per repo.*

### Sweep polish

- TTY status messages for all sweep phase transitions (`cbaaa03`)
- Manual actions surfaced at end of sweep (`2967cd4`)
- Sweep DB writes fixed to target original repo during worktree execution (`caaa313`)
- Grouped fix commit messages reformatted with individual cluster reports (`fa02654`)

---

## OpenRouter & config polish (Apr 2–5)

**Commits:** `0bcf0d1` → `807ab67`

### OpenRouter summarizer (`0bcf0d1`)

The summarizer now supports remote models via OpenRouter in addition to local
Ollama. Config: `"summarizerModel": "openrouter:openai/gpt-4o-mini"`. Requires
`OPENROUTER_API_KEY`. The `reviewer` config key was renamed to `reviewers`
(plural) for consistency with the CLI flag.

### OpenCode + OpenRouter fix (`11ce057`)

OpenRouter models served through OpenCode hang when `--format json` is passed.
The adapter now detects `openrouter/` model prefixes and omits the JSON format
flag, falling back to text parsing.

### Dashboard discard reasons (`807ab67`)

Unfixed findings in the dashboard now show why they were skipped (merge
conflict, reviewer rejection, timeout, etc.).

---

## By the numbers

| Metric | Count |
|--------|-------|
| Total commits | 149 |
| Calendar days | 10 (Mar 26 – Apr 5, 2026) |
| Source files | 85 |
| Test files | 27 |
| Total TypeScript lines | ~16,500 |
| Tests | 481 |
| Scan tasks | 11 |
| Agent adapters | 5 (Claude, Codex, Cursor, Gemini, OpenCode) |
| CLI commands | scan, fix, report, list, init, enrich, sweep |
| Execution plans written | 4 |
| Reverts | 2 |

---

## Patterns worth noting

**Plan-first development.** Every non-trivial feature (fix phases A/B/C,
validation, sweep) started with a written execution plan. The plan was
reviewed, refined based on feedback, then implemented. Plans were moved to
`docs/exec-plans/completed/` when done.

**Config-driven real-world usage.** The config refinement arc (12 commits in 3
hours) shows the project being actively used against real repositories. Each
fix addressed a real pain point discovered during actual scanning/fixing.

**Two types of velocity.** The enrichment detour and config arc are both "fast
and messy" — lots of small commits, a revert, iterating on details. The major
features (dedup, worktrees, sweep, batched fix) are "plan and execute" — one
or two large, well-structured commits per feature.

**Monotonically increasing scope.** The project expanded in concentric rings:
one agent → four agents → dedup across agents → fix one → fix batch → fix
parallel → fix batched-disjoint → sweep all tasks. Each ring built on the
previous one without rewriting it.
