---
satisfies: [R1, R3, R5]
---
# fn-115-fix-graph-stalls-and-http-rerank-pull.2 Avoid graph event-loop stalls

## Description
Replace getGraph correlated per-link SQL resolution with a bounded indexed resolution path that preserves existing graph semantics and output.

## Acceptance
- #186 synthetic graph completes within a conservative regression budget without starving a scheduled timer.\n- Existing graph resolution, audit, weighting, filtering, similarity, and truncation tests pass.\n- No query-time freshness regression for renamed, newly added, or ambiguous targets.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
