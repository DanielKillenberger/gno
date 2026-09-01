---
satisfies: [R1, R4, R7]
---
# fn-130-memory-slice-rememberrecall-contracts.4 REST + SDK surfaces + cross-surface contract

## Description
REST + SDK surfaces + cross-surface contract. **Size:** M. **Files/Touches:** src/serve/routes/api.ts, src/sdk/client.ts + types, spec/output-schemas/memory-remember.schema.json + memory-recall.schema.json, test/spec/schemas/memory*, docs/API.md.
POST /api/memory/remember + /api/memory/recall (loopback + CSRF conventions, write-path admission per existing REST write rules); client.remember()/client.recall(); ONE shared zod schema powering all four surfaces (incl. required caller/session identity fields AND the required egressLineage field on recall results); adapters delegate to core (no lease in adapters). Cross-surface contract tests assert byte-compatible result shapes across CLI --json / MCP / REST / SDK for the same operations.

**Touches:** src/serve/routes/api.ts, src/sdk/client.ts, src/sdk/types.ts, spec/output-schemas/memory-*.schema.json (new), test/spec/schemas/memory*, docs/API.md

## Acceptance
- [ ] Both endpoints enforce loopback+CSRF and the write path honors existing REST write admission; live curl verification
- [ ] SDK methods round-trip add/supersede/recall against a temp index (contract test)
- [ ] Output schemas committed; contract tests prove all four surfaces emit identical shapes for identical inputs
- [ ] docs/API.md + SDK docs in the same change

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
