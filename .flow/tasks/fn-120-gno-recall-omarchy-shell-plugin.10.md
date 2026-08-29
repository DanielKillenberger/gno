---
satisfies: [R12]
---
# fn-120-gno-recall-omarchy-shell-plugin.10 Shift+Enter deep search via gno query (balanced)

## Description
Overlay-only: Shift+Enter runs gno query at balanced depth for the current query text; Enter search stays BM25. Parse results[] envelope, source.absPath present so open behavior unchanged. R7/R9 rules, >=60s timeout, distinct deep-search in-progress state, generation-ID late-drop, help copy, README + live QA evidence.

## Acceptance
Live evidence: Shift+Enter on a real query shows deep in-progress state then hybrid results; Enter on a deep hit opens a visible window; timeout/failure shows inline error with overlay interactive; plain Enter still BM25; README documents the key.

## Done summary
Shift+Enter deep search shipped (commit 64fd7a8, omarchy-gno-recall main).

- `runSearch(query, deep)` shared pipeline: deep runs `gno query <text> --json
  --no-project-affinity -n 20` at balanced depth; BM25 path unchanged.
- One shared `searchGenerationId` across modes; pending-deep flag threaded
  through cancel-inflight and onExited so a late deep result can never clobber
  a newer fast search (proven live: gen=27 deep late-dropped, gen=29 bm25 won).
- `deepSearchTimeoutMs` 90000 with kill timer; mode-specific error/timeout/
  spawn-failure/oversized copy; envelope parser accepts `results[]` and
  `hits[]`.
- Overlay: Shift+Enter → `commitDeepSearch()` (empty query no-op, browse mode
  no-op); distinct "Deep searching… (embeddings + rerank)" and "N deep hits"
  copy; help lines advertise the key. README keys table updated.
- Live QA in /tmp/fn-120.10-qa/: deep in-flight + results screenshots, real
  keyboard (wtype) driving, deep hit opened a visible window, plain-Enter BM25
  regression (~0.4s), bm25-vs-deep comparison (Portability Runbook only found
  by deep), supersede journal proof.
- Host review: verified timeout wiring (line 944), shared-generation contract,
  no opener regressions, live shell running new code with clean default opener
  state.
## Evidence
- Commits: 64fd7a8
- Tests: live QA /tmp/fn-120.10-qa/ (deep in-flight/results, deep-open window proof, plain-enter regression, supersede journal)
- PRs: