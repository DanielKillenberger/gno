# WebUI first page load

## Conversation Evidence

> user (turn 1): "Can you have it capture a spec to address this? P95 performance should load the page first time in 200ms max. Reasonable and achievable metric?"
> user (turn 1, part 2): "this" = first page load of GNO WebUI, from the investigation on SHA b6c7bffe0ba3de22ef4fa260ba43914b947c0934.
> user (turn 1, part 3): User bar: P95 first-time page load ≤ 200ms.
> user (turn 1, part 4): Define "page load" as time from navigation start to first paint of home chrome (Dashboard shell visible), localhost, production serve, cold JS cache. That is the 200ms P95 acceptance criterion.
> user (turn 1, part 5): TTI / Dashboard health data filled in is NOT the 200ms bar. Call that out as a separate, slower budget.
> user (turn 1, part 6): 200ms P95 for a painted shell is achievable after the P0 bundle split. 200ms P95 TTI with the leftover ~3.9 MB home JS is not the same metric and is not claimed.
> user (turn 1, part 7): Serve path must emit split chunks (HTMLBundle today inlines). Route-lazy alone will not help until that is true.
> user (turn 1, part 8): Then lazy non-home routes so Dashboard is not paying for editor/markdown/ask/graph/pdf.
> user (turn 1, part 9): Then shrink Shiki on the home graph (allowlist / delay highlighter).
> user (turn 1, part 10): Default WebUI serve should be production bundle unless explicitly dev/hot.
> user (turn 1, part 11): Optional tiny static skeleton in the HTML shell is cosmetic only; real win is JS weight.
> user (turn 1, part 12): DONE WHEN: P95 ≤ 200ms from navigation start to first paint of home chrome, localhost production, cold JS cache, documented how to measure (N and harness).
> user (turn 1, part 13): Home first JS is a split entry, not one 11.8 MB file. PDF/graph/Shiki grammars are not in that first file.
> user (turn 1, part 14): Default `gno serve` is not the 17 MB dev bundle.
> user (turn 1, part 15): Other flow specs untouched.
> user (turn 1, part 16): Do not implement in capture. Do not mark ready. Do not claim 200ms TTI. Do not change retrieval/KB/MCP. Do not require a live remote tap (unreachable in the investigation).
> user (turn 2): P95 ≤ 200ms is FIRST PAINT of home chrome (navigation start → first paint), localhost, production serve, cold JS cache.
> user (turn 2, part 2): Second bar: P95 TTI (Time to Interactive: clicks respond) ≤ 1s on the same harness. Not 200ms TTI.
> user (turn 2, part 3): No major architectural rewrite. Stay on the current client SPA. Work is: HTMLBundle emits split chunks, lazy non-home routes, Shiki/pdf/graph off the first file, default serve is production bundle. Not SSR, not a new framework, not a rewrite of retrieval/KB.

## Goal & Context

<!-- scope: business -->
<!-- Source-tag breakdown: 85% [user] / 15% [paraphrase] -->

First-time load of the GNO WebUI home page is too heavy. Two bars, same harness (localhost, production serve, cold JS cache):

1. P95 ≤ 200ms from navigation start to first paint of home chrome (Dashboard shell visible). That 200ms bar is first paint only. [user]
2. P95 TTI (Time to Interactive: clicks respond) ≤ 1s. This is not a 200ms TTI bar. [user]

Dashboard health data filled in is not either bar. A painted shell at 200ms P95 is treated as achievable after the first-chunk split. 200ms P95 TTI is a different metric and is not claimed.

The product work is incremental on the current client SPA: stop shipping one fat first JavaScript file, keep non-home features off that file, and make default WebUI serve the production bundle unless the operator asked for dev/hot. No major architectural rewrite. [user]

## Architecture & Data Models

<!-- scope: technical -->
<!-- Source-tag breakdown: 80% [paraphrase] / 20% [user] -->

Stay on the current client-rendered SPA. The HTML shell paints an empty root; Dashboard chrome appears only after the first JavaScript module evaluates. This spec does not introduce server-side rendering or a new UI framework. [user]

The production serve path currently emits one non-split JavaScript payload (investigation-measured about 11.8 MB uncompressed / about 2.4 MB gzip) plus a small CSS file. Default CLI serve is development when the environment is not production (investigation-measured about 17.1 MB JS). Desktop already forces production.

Existing lazy imports on graph and PDF viewers do not reduce first-load bytes while the serve path inlines. The app entry statically binds every route, so even a splitting bundler still puts editor, markdown, ask, graph, and PDF on the home graph until those routes are lazy.

The allowed work is: make the HTMLBundle emit split chunks; then lazy non-home routes; then keep Shiki, PDF, and graph off the first file; then default serve the production bundle unless explicitly dev/hot. [user]

Home first data calls are status endpoints (counts and health), not a vault dump. Chrome may also request model presets. That work can delay filled-in health content; it is not the 200ms first-paint bar and is not the 1s TTI bar.

Syntax highlighting currently value-imports the full language table and creates the highlighter when that module evaluates. Until the serve path emits real split chunks, route-lazy and highlighter delays will not change first-load bytes.

## Edge Cases & Constraints

<!-- scope: technical -->

- The 200ms P95 bar applies only to first paint of home chrome (navigation start → first paint), localhost, production serve, cold JS cache. [user]
- The second bar is P95 TTI (clicks respond) ≤ 1s on that same harness. It is not a 200ms TTI bar. [user]
- Dashboard health data filled in is a separate, slower budget and is not either bar. [user]
- 200ms P95 TTI is not claimed. [user]
- Route-lazy does not count as done while the serve path still inlines a single chunk. [paraphrase]
- Delivery stays on the current client SPA: no SSR, no new framework, no major architectural rewrite. [user]
- Retrieval, knowledge-base, and MCP behavior are out of scope. [user]
- A live remote tap is not required to accept this spec. [user]
- Default WebUI serve is production unless the operator explicitly requested dev/hot. [user]
- An optional tiny static skeleton in the HTML shell is cosmetic only; it does not satisfy the 200ms bar. [user]
- Measurement must record N and the harness so two reviewers can repeat the same P95 for both bars. [user]

## Acceptance Criteria

<!-- scope: both -->

- **R1:** P95 of first-time page load is ≤ 200ms, measured from navigation start to first paint of home chrome (Dashboard shell visible), on localhost, production serve, cold JS cache. [user]
- **R2:** The measurement method documents N and the harness used. [user]
- **R3:** Home first JavaScript is a split entry, not a single ~11.8 MB file; PDF, graph, and Shiki grammars are absent from that first file. [paraphrase]
- **R4:** Default `gno serve` does not ship the ~17 MB development bundle. [user]
- **R5:** The WebUI serve path emits split chunks; route-lazy alone does not satisfy this while the serve path inlines. [paraphrase]
- **R6:** Non-home routes load after home so Dashboard does not pay for editor, markdown, ask, graph, or PDF on first paint. [paraphrase]
- **R7:** Syntax highlighting on the home graph uses an allowlist or delayed highlighter so unused grammars are not in the first file. [paraphrase]
- **R8:** P95 TTI (Time to Interactive: clicks respond) is ≤ 1s on the same harness as R1 (localhost, production serve, cold JS cache). This is not a 200ms TTI bar. [user]
- **R9:** Delivery stays on the current client SPA: HTMLBundle split chunks, lazy non-home routes, Shiki/PDF/graph off the first file, default production serve. Not SSR and not a new framework. [user]

## Boundaries

<!-- scope: business -->

- Do not claim 200ms P95 time-to-interactive or 200ms P95 for Dashboard health data filled in. [user]
- Do not change retrieval, knowledge-base, or MCP behavior. [user]
- Do not require a live remote tap to measure or accept. [user]
- Do not modify other flow specs. [user]
- Do not treat an optional HTML skeleton as the performance win. [user]
- Do not expand this spec into Browse-tree, autocomplete, or other non-home surfaces. [paraphrase]
- Do not perform a major architectural rewrite: no SSR, no new framework, no replacement of the current client SPA. [user]

## Decision Context

<!-- scope: both — conditionally substructured -->

### Motivation
<!-- scope: business -->

- Success is two bars on one harness: P95 ≤ 200ms to a painted home shell, and P95 TTI (clicks respond) ≤ 1s. Neither is a filled health panel. [user]
- Sequence the work: emit split chunks on the serve path, then lazy non-home routes, then shrink highlighting / keep PDF and graph off the first file. [paraphrase]
- JavaScript weight is the real win; a static skeleton is optional and cosmetic. [user]
- A 200ms painted shell is treated as achievable after the first-chunk split; a 200ms TTI claim is rejected in favor of the 1s TTI bar. [user]
- Stay on the current client SPA. Incremental bundle and route-lazy work; not a rewrite. [user]

## Parked unknowns

- No numeric budget is set for Dashboard health data filled in. Resolve only if a later spec takes that bar.
- Exact N for the P95 harness is not prescribed here; R2 requires the implementation to document it. Both R1 (first paint) and R8 (TTI) use that same harness.

## Requirement coverage

| R-ID | Task | Notes |
|------|------|-------|
| R1 | fn-N.M (TBD — populate via /flow-next:plan) | P95 ≤ 200ms first paint of home chrome |
| R2 | fn-N.M (TBD — populate via /flow-next:plan) | Document N and harness |
| R3 | fn-N.M (TBD — populate via /flow-next:plan) | Split first JS; no PDF/graph/Shiki grammars |
| R4 | fn-N.M (TBD — populate via /flow-next:plan) | Default serve is not the 17 MB dev bundle |
| R5 | fn-N.M (TBD — populate via /flow-next:plan) | Serve path emits split chunks |
| R6 | fn-N.M (TBD — populate via /flow-next:plan) | Lazy non-home routes |
| R7 | fn-N.M (TBD — populate via /flow-next:plan) | Highlight allowlist or delayed highlighter |
| R8 | fn-N.M (TBD — populate via /flow-next:plan) | P95 TTI (clicks respond) ≤ 1s, same harness; not 200ms TTI |
| R9 | fn-N.M (TBD — populate via /flow-next:plan) | Stay on current client SPA; no SSR / no new framework |
