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

Evidence: live stdio `gno mcp --enable-write` probe with a 4,000-file gno_sync job: gno_search returned in 7 ms while the job was running (main: 15,015 ms, returned only after the job completed).

stage: impl-review - skipped(config: repository instructions say "Skip all review stages")

stage: plan-sync - skipped(config: planSync.enabled != true)
## Evidence
- Commits: aae84e2f87e95385f661406ca7d471c8be995384
- Tests: bun test test/core test/mcp
- PRs: