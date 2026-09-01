---
satisfies: [R1, R2, R6]
---
# fn-131-slim-mcp-core-tool-profile-and-mcp-2026.1 Tool-profile mechanism + core membership decision

## Description
Tool-profile mechanism + membership decisions. **Size:** M. **Files/Touches:** src/mcp/server.ts + registry, src/serve HttpGatewayConfigSchema + HttpGatewayOverrides + serve/daemon CLI wiring + detached-child argv, spec/mcp.md (profile section), test/mcp/profile*.
Profile selection: CLI `gno mcp --tool-profile core|full`; resident gateway config key `gateway.toolProfile` (HttpGatewayConfigSchema mounts under root key `gateway`); serve/daemon CLI override `--mcp-tool-profile`; precedence: CLI flag > config > default `full`; applies on listener start (restart to change, documented). Runs on the POST-MIGRATION SDK (depends on task 4). Core READ set (decided against the skill playbook's routing advice, ≤7): gno_query, gno_search, gno_get, gno_multi_get, gno_context, gno_changes, gno_recall (present — fn-130 lands first; spec dependency now encoded). Core WRITE set with --enable-write is an EXACT allowlist: gno_capture, gno_remember, plus gno_job_status iff any exposed write is async (no unpollable jobs). full = byte-identical registry AND descriptions to today. Tests: profile selection, write gate never weakened, full-profile byte-compat snapshot.

**Touches:** src/mcp/server.ts, src/mcp registry module, src/serve gateway config schema + serve/daemon CLI wiring + detached-child argv, spec/mcp.md (profile section), test/mcp/profile*

## Acceptance
- [ ] Live MCP listing: core shows exactly the documented read set; +write shows exactly the write allowlist; full is byte-identical to pre-change snapshot (descriptions included)
- [ ] Config key + CLI flag + precedence + restart semantics implemented and documented; resident gateway honors profile for all clients
- [ ] Write tools never appear without --enable-write in either profile (test)
- [ ] Exact allowlists recorded in spec/mcp.md

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
