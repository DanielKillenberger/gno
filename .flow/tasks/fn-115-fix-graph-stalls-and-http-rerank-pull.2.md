---
satisfies: [R1, R3, R5]
---
# fn-115-fix-graph-stalls-and-http-rerank-pull.2 Avoid graph event-loop stalls

## Description
Replace getGraph correlated per-link SQL resolution with a bounded indexed resolution path that preserves existing graph semantics and output.

## Acceptance
- #186 synthetic graph completes within a conservative regression budget without starving a scheduled timer.\n- Existing graph resolution, audit, weighting, filtering, similarity, and truncation tests pass.\n- No query-time freshness regression for renamed, newly added, or ambiguous targets.

## Done summary
getGraph now resolves link targets through the existing semantics-equivalent adaptive bulk resolver, preserving weights, confidence/audit, unresolved totals, and collection behavior. Added event-loop/performance and cross-collection regressions; full-scale synthetic graph fell to 34 ms.
## Evidence
- Commits: 20263493
- Tests: bun test test/store/graph-performance.test.ts test/store/links.test.ts test/audit/links.test.ts, bun run lint:check, bun run docs:verify, synthetic 2470-doc 8146-link getGraph: 34ms
- PRs: