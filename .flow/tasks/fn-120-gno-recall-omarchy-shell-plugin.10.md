---
satisfies: [R12]
---
# fn-120-gno-recall-omarchy-shell-plugin.10 Shift+Enter deep search via gno query (balanced)

## Description
Overlay-only: Shift+Enter runs gno query at balanced depth for the current query text; Enter search stays BM25. Parse results[] envelope, source.absPath present so open behavior unchanged. R7/R9 rules, >=60s timeout, distinct deep-search in-progress state, generation-ID late-drop, help copy, README + live QA evidence.

## Acceptance
Live evidence: Shift+Enter on a real query shows deep in-progress state then hybrid results; Enter on a deep hit opens a visible window; timeout/failure shows inline error with overlay interactive; plain Enter still BM25; README documents the key.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
