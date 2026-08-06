# Plan

## Problem

GitHub #186 makes graph reads synchronously block the Bun event loop; GitHub #187 misclassifies HTTP rerank endpoints as downloadable cache models.

## Requirements

- **R1:** Graph reads preserve current nodes, links, weights, confidence, audit, unresolved counts, collection filtering, truncation, and similarity behavior while avoiding per-link correlated document scans.
- **R2:** HTTP rerank endpoints bypass cache lookup/download in model-pull flows and report a successful external-endpoint skip; downloadable local/Hugging Face models remain unchanged.
- **R3:** Focused regressions cover both bugs, including a moderately sized graph performance/event-loop case and Web/CLI model-pull lifecycle behavior.
- **R4:** User-facing CLI/spec documentation and changelog remain synchronized.
- **R5:** Full repository gates and live Web/API QA pass before release.

## Delivery

Two implementation tasks, one commit per task where practical, followed by patch release verification.
