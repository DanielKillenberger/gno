## Goal & Context

Document and market what fn-129 through fn-132 ship, on the hosted site (~/work/gno.sh) and in the repo's user-facing docs where not already covered by those specs — under the site's copy rules (positive frames, mechanism-first headlines, no promotional vocabulary, no negative parallelism except precise distinctions and honest limits, honest bounds always). Distribution is a first-class gap (strategy note gap 1); this spec is sequenced last because it must describe shipped behavior, never promise ahead of it.

Depends on fn-129, fn-130, fn-131, fn-132 having landed; scope flexes to exactly what shipped.

## What

1. **Memory positioning on the site**, under the decided claim: "one auditable memory store for every agent you authorize" — auditable (markdown, provenance, append-only supersession), authorized (fail-closed scopes), local, cited. A memory feature page (or extension of an existing page set) with the mechanisms: remember/recall on four surfaces, supersession, fencing, scoping, the edit/capture/remember taxonomy. Homepage touch only where a claim becomes newly true (e.g. FAQ answer about agent memory updated from retrieve-on-demand-only); no homepage restructure.
2. **Agents-install documentation**: docs + site reference for `gno agents install` (targets matrix with evidence, marker/versioning semantics, the ladder the block teaches), positioned as a user-configurable knowledge protocol, not a vault convention.
3. **qmd comparison refresh — verification-driven, never hard-coded** (this plan's own earlier claims already drifted: structured_search was renamed/removed; qmd's `generate` model does query expansion, not answers). The task verifies against qmd's live README/changelog at execution time, narrows "read-only" to its MCP/corpus-write surface, and adds the honest new lines: slim tool profile, protocol currency, the memory split. GBrain memory section to shipped tense. Sweep includes site-content.ts and gno-docs.tsx tool-count claims and updating public-truth-content.test.ts locks; new slugs must land in prerender-routes.ts and the sitemap.
4. **MCP profile + protocol docs on site** where user-facing (integrations pages referencing tool counts; the "25 read-only tools" claims across integration pages must track the profile story accurately).
5. **Retrieval + writing contract as public documentation**: the ladder (search → query → context → verified ask; diagnose misses) and the writing taxonomy (edit vs capture vs remember) as a docs page — the generalized version of the validated protocol.

## Edge Cases & Constraints

- Copy rules are hard acceptance criteria, not style suggestions; run the anti-slop review pass before merge.
- Every numeric/behavioral claim traceable to shipped code or committed artifacts; no forward-looking promises.
- Site QA gate applies: changed pages driven locally and on production after deploy, with captured evidence.
- Repo docs for each feature ship with that feature's own spec; this spec covers the SITE plus cross-cutting docs (the protocol page) — audit for gaps rather than duplicating.

## Acceptance Criteria

- R1: Memory feature/docs pages live on the site with the decided positioning and mechanism-level copy; every claim maps to shipped behavior. Driven on prod.
- R2: qmd and GBrain comparison pages updated to current qmd 2.x reality and shipped GNO memory; no stale claims remain (sweep the comparison set for tool-count and capability drift). Driven on prod.
- R3: Agents-install reference page with the verified harness matrix. Driven on prod.
- R4: The retrieval/writing protocol documented as a user-facing page (docs and/or site reference). Driven on prod.
- R5: Copy-rule pass on all changed pages recorded (findings addressed or explicitly accepted); site gates green; deploy verified per the standard heimdall flow.

## Boundaries

- Out: homepage repositioning (done 2026-08/09; only truth-updates allowed here).
- Out: new comparison pages beyond updating existing ones.
- Out: launch/announcement content (posts, changelogs beyond the repo's standard CHANGELOG discipline).

## Pilot routing

plan (multiple site surfaces + docs audit; scope flexes to what shipped).
