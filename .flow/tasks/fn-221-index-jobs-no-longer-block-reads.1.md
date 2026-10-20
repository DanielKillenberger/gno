---
satisfies: [R1, R2]
---
# fn-221-index-jobs-no-longer-block-reads.1 Implement Index jobs no longer block reads

## Description
TBD

## Acceptance
Every R-ID in the parent spec's ## Acceptance Criteria is satisfied; judge this task against the spec's criteria directly.

## Done summary
Background jobs (sync, embed, index) now take the MCP tool mutex only to wait for the tool call in progress and re-check the egress authorization epoch, then release it before their work runs. Searches and other reads over stdio MCP and the resident /mcp no longer wait for a running job; writers stay serialized by the shared write lease. Spec contract line in spec/mcp.md and CHANGELOG updated.

Follow-up (PR #333): a separate job write connection broke direct writes on the shared connection ("database is locked", browser clipper). Reworked: all writes stay on one connection; MCP retrieval tools read on a query-only second connection; vector partition resolution writes on the shared connection.

OVERRIDDEN: 1 declined finding (impl-review stalled after 5 rounds). Reviewer: on an upgraded index, the first vector query during an open sync batch waits for that batch because the one-time legacy-partition migration commits with it; search the committed legacy partition instead. Decision (Daniel, 2026-10-20): "yes just keep and note it" - the wait is one-time per upgraded index, bounded by one batch, and returns correct results; searching the legacy partition directly adds complexity for that window.

Evidence: live stdio `gno mcp --enable-write` probe with a 4,000-file gno_sync job: gno_search returned in 7 ms while the job was running (main: 15,015 ms, returned only after the job completed).

stage: impl-review - skipped(config: repository instructions say "Skip all review stages")

stage: plan-sync - skipped(config: planSync.enabled != true)
## Evidence
- Commits: aae84e2f87e95385f661406ca7d471c8be995384
- Tests: bun test test/core test/mcp
- PRs: