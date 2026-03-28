# Kaicho — Agent Map

Kaicho runs AI coding agents against repositories and collects structured
suggestions. The core loop is: invoke agent -> capture output -> structure
suggestions. Everything in this repo serves that loop.

## Quick orientation

| What you need              | Where to look                          |
|----------------------------|----------------------------------------|
| Domain model & layering    | [ARCHITECTURE.md](ARCHITECTURE.md)     |
| Design principles          | [docs/design-docs/core-beliefs.md](docs/design-docs/core-beliefs.md) |
| Product specs & user flows | [docs/product-specs/index.md](docs/product-specs/index.md) |
| Current execution plans    | [docs/exec-plans/active/](docs/exec-plans/active/) |
| Completed plans & history  | [docs/exec-plans/completed/](docs/exec-plans/completed/) |
| Known tech debt            | [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md) |
| Quality grades by domain   | [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md) |
| Frontend conventions       | [docs/DESIGN.md](docs/DESIGN.md)       |
| Reliability requirements   | [docs/RELIABILITY.md](docs/RELIABILITY.md) |
| Security boundaries        | [docs/SECURITY.md](docs/SECURITY.md)   |
| Product sense & taste      | [docs/PRODUCT_SENSE.md](docs/PRODUCT_SENSE.md) |
| Plan index                 | [docs/PLANS.md](docs/PLANS.md)         |
| Reference material (llms.txt, etc.) | [docs/references/](docs/references/) |

## Repo conventions

- **Language:** TypeScript (strict mode). Prefer boring, composable tech.
- **Boundaries:** Parse and validate all data at system edges (agent output,
  API responses, CLI args). Interior code trusts typed interfaces.
- **Tests:** Every module has co-located tests. Agent output parsers require
  snapshot tests with real agent output samples.
- **Logging:** Structured JSON logging only. No bare `console.log`.
- **Naming:** `kebab-case` files, `PascalCase` types, `camelCase` functions.
- **File size:** Keep files under 300 lines. If a file grows past that, split it.
- **Imports:** No circular imports. Dependency direction follows the layer
  diagram in ARCHITECTURE.md.

## Agent workflow

1. Read this file first for orientation.
2. Check the relevant section in the table above for your task domain.
3. For complex work (3+ domains, sequential dependencies, non-obvious
   decisions, or multi-session scope), check
   [docs/exec-plans/active/](docs/exec-plans/active/) for an existing plan.
   If none exists, **create one** using the template in
   [docs/PLANS.md](docs/PLANS.md) before starting implementation.
   Update [docs/PLANS.md](docs/PLANS.md) index when adding or completing plans.
4. Run `npm test` before opening a PR. Run `npm run lint` to catch structural
   violations.
5. If you add a new domain or package, update ARCHITECTURE.md.
6. If you add or change a user-facing behavior, update the relevant spec in
   [docs/product-specs/](docs/product-specs/). If no spec exists for the
   feature, **create one** and add it to the index in
   [docs/product-specs/index.md](docs/product-specs/index.md).
7. If you ship or significantly change a domain, update its grade in
   [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md). Add new domains to the
   table. Downgrade if you introduced debt; upgrade if you added tests or
   hardened the module.
8. If you add, rename, or change the shape of a data contract (Suggestion,
   RunRecord, SuggestionCluster, KaichoConfig), update the corresponding
   JSON Schema in [docs/generated/](docs/generated/) and its
   [README](docs/generated/README.md).
9. If you discover tech debt, log it in
   [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md).
10. If you add or change CLI flags, commands, scan tasks, config options, or
    default values, update [README.md](README.md) to match. The README is
    the user's first contact — it must reflect the current state of the CLI.

## What NOT to do

- Do not put long instructions in this file. Add them to the appropriate doc
  and link from here.
- Do not skip boundary validation because "it's just internal."
- Do not add dependencies that can't be reasoned about from their types alone.
- Do not leave undocumented magic strings or environment variables.
