# Sweep Layer Ordering

`kaicho sweep` processes scan tasks in a fixed priority order, grouped into
7 layers. Fixes from higher-priority layers are applied before lower-priority
layers are scanned, so that later scans see the improved codebase.

## Layers

| Layer | Tasks | Rationale |
|-------|-------|-----------|
| 1 | security | Highest stakes. Security fixes are non-negotiable and should not be overridden by any other domain. Applied first so all subsequent layers scan against a security-hardened baseline. |
| 2 | qa | Correctness bugs. Second highest priority because incorrect behavior undermines every other quality dimension. QA fixes depend on security being clean (e.g., input validation already in place). |
| 3 | contracts, state | Boundary and state management issues. These depend on security and correctness being addressed — fixing a contract violation is pointless if the underlying code has a bug. Grouped because both deal with data flow correctness at different granularity. |
| 4 | resources, resilience | Operational correctness: resource lifecycle, concurrency, fault tolerance. These are implementation-level concerns that build on correct contracts and state management. Grouped because both address "does this work under real conditions." |
| 5 | performance | Optimization. Must come after security and correctness — a performance fix that removes validation or simplifies error handling is a regression. Performance findings are only valid against functionally correct code. |
| 6 | logging | Observability. Low conflict risk with earlier layers. Logging changes rarely break functionality but can be affected by earlier structural changes (e.g., new error handling paths need logging). |
| 7 | testing, docs, dx | Process quality. Lowest conflict risk, most subjective. These should run last because they evaluate the final state of the code — including all fixes from earlier layers. Testing scans should see the post-fix code. |

## Why this order matters

Fixes from different domains can conflict. Common conflicts:

- **Security vs Performance**: Security adds validation overhead; performance
  removes unnecessary computation. If performance runs first, it might remove
  a check that security would have flagged.
- **QA vs DX**: QA adds defensive code (null checks, error handling); DX wants
  minimal code. Running DX first could strip guards that QA needs.
- **Contracts vs State**: Both touch data flow but from different angles. Contracts
  focus on boundaries; state focuses on mutation discipline. Running them in the
  same layer lets their findings be fixed together without one undoing the other.

The layered approach resolves these by establishing a priority: higher layers'
fixes are treated as constraints that lower layers must not violate.

## Regression detection

After fixing layer N, sweep re-scans layer N-1 tasks. If new critical or high
severity findings appear, the layer N fixes are reverted and logged. This ensures
the priority ordering is enforced not just in scan order but in fix outcomes.
