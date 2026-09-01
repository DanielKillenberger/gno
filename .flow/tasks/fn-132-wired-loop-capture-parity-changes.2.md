---
satisfies: [R1, R6]
---
# fn-132-wired-loop-capture-parity-changes.2 Capture parity: MCP/REST capture syncs before success

## Description
Capture parity: MCP/REST capture success = retrievable. **Size:** M. **Files/Touches:** src/mcp/tools/capture.ts, src/serve/capture-service.ts + routes (REST currently returns 202 before sync; MCP returns tool-success containing sync.status:"failed"), src/core/capture.ts sync helper, tests.
Success semantics (binding): capture succeeds ONLY when write + lexical sync complete under the lease; sync failure → tool error / non-2xx (no success-with-failed-sync); lease-busy behaves per the v1.38 contention contract; open_existing on an unindexed file syncs it before success. REST becomes synchronous for this path (or gains an explicit completed-state polling contract — pick one, document; default synchronous). Receipt splits write/sync; embed state stays separate per task 1's contract. Live one-turn capture→search-hit verification incl. a concurrent writer.

**Touches:** src/mcp/tools/capture.ts, src/serve/capture-service.ts, src/serve/routes capture path, src/core/capture.ts, spec/mcp.md capture section, docs/API.md, tests

## Acceptance
- [ ] MCP capture with failing sync returns an MCP error, not success (test); REST returns success only after retrievability
- [ ] Live one-turn loop: gno_capture → immediate gno_search hit, with a concurrent CLI writer running (lease serialisation observed)
- [ ] open_existing unindexed file case covered
- [ ] spec/mcp.md + API docs updated to the new semantics

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
