---
satisfies: [R2, R4, R5]
---
# fn-135-memory-adapters-openclaw-backend-hermes.3 OpenClaw search-backend (market-driven)

## Description
OpenClaw memory plugin (market-driven). **Size:** M-L. **Files/Touches:** NEW plugin artifact; sandbox verification script in ~/work/sandbox/openclaw-dogfood; docs region: docs/MEMORY.md "OpenClaw plugin" subsection only.
INTERFACE CORRECTION (plan review, verified): OpenClaw 2026.8.1 RETIRED `memory.backend`; external memory ships as a `kind: "memory"` plugin selected via `plugins.slots.memory` (their docs/tools/plugin.md; the old qmd backend was removed). Verify the current contract against those docs at execution start; do not assume this note is still current.
Corpus provisioning (binding, was undefined): plugin init registers the OpenClaw workspace memory paths as a GNO collection (explicit config: collection name + paths); writes OpenClaw makes to memory files reach the index via sync-before-search (plugin triggers gno update on the collection before serving a search, or watch mode when the daemon runs — pick one, document; deletion reconciliation via existing watcher semantics; runtime state dirs excluded).
SELLING-POINT CORRECTION: drop "semantic memory with no API key" (OpenClaw supports local GGUF via memory.search.provider: local). Honest differentiators: one index across every harness and format (memory files searched NEXT TO PDFs/mail/code), gno:// citations with hashes, the evidence layer, scoped recall.

**Touches:** integrations/openclaw-gno-memory/** (new), sandbox verification script in ~/work/sandbox/openclaw-dogfood, docs/MEMORY.md OpenClaw subsection (safe: runs after tasks 1-2 via dependency)

## Acceptance
- [ ] Current OpenClaw plugin contract re-verified at execution and recorded; plugin loads via plugins.slots.memory in the sandbox
- [ ] Canaries retrieved through OpenClaw memory search backed by GNO; a NEW memory file written after init is retrievable (provisioning/sync proven, not just pre-seeded index)
- [ ] Deletion/rename of a memory file reconciles; runtime state dirs excluded from the collection
- [ ] Failure modes (gno missing/below-min, subprocess timeout, malformed output) degrade cleanly with clear errors; sync/watch observability: plugin logs index-trigger outcomes and exposes a stale-index warning when sync fails (documented contract)
- [ ] Docs subsection with the honest differentiator list (no no-API-key claim)

- [ ] Deterministic unit suite green (faked subprocess cases); packaging README with install commands
- [ ] fn-134 gate evidence recorded at start

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
