---
satisfies: [R2, R5]
---
# fn-133-site-and-docs-memory-positioning-agents.3 Comparison + integration truth sweep

## Description
Comparison + integration truth sweep. **Size:** M. **Files/Touches (exclusive):** gno.sh src/lib/gno-comparisons.tsx, src/lib/integration-pages.ts, src/lib/public-truth-content.test.ts (the test currently LOCKS "25 read-only"/"15 write"/"40 tools" strings — update assertions to the profile story), plus tool-count strings in gno-docs.tsx integration/docs pages (coordinate: gno-docs memory/protocol pages belong to tasks 1/2; this task touches ONLY tool-count/capability lines elsewhere in that file).
qmd page: VERIFY against qmd's current README/changelog at execution time — do NOT hard-code this plan's claims (known drift as of 2026-09-01 review: structured_search renamed/removed; `generate` model does query expansion, not answer generation; "read-only" must be narrowed to its MCP/corpus-write surface). GBrain page memory section to shipped tense. Sweep ALL comparison + integration pages for tool-count and capability drift against the fn-131 profile story.

**Touches:** gno.sh: src/lib/gno-comparisons.tsx (exclusive), src/lib/integration-pages.ts (exclusive), src/lib/public-truth-content.test.ts, gno-docs.tsx tool-count lines only

## Acceptance
- [ ] qmd page claims re-verified against live qmd docs at execution (verification noted in the change); no stale claims remain
- [ ] public-truth-content.test.ts assertions updated to the profile story and green
- [ ] Tool-count sweep complete across comparisons + integrations + docs pages (list of touched claims in the PR)
- [ ] product-pages.ts untouched (task 1 owns it)

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
