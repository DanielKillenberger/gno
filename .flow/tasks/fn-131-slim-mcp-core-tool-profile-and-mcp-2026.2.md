---
satisfies: [R3, R6]
---
# fn-131-slim-mcp-core-tool-profile-and-mcp-2026.2 MCP 2026-07-28 dual-speak

## Description
2026-07-28 negotiation + sessionless transport + guard parity. **Size:** M. Runs on the POST-MIGRATION SDK (depends on task 4, which owns the v2 migration itself).
Dual-era support: 2025-11-25 clients (initialize-style) keep working byte-for-byte; 2026-07-28 clients negotiate natively (server/discover, sessionless Streamable HTTP). CRITICAL guard parity on the modern sessionless path: authentication, write rejection, egress enforcement, concurrency admission, authorization-epoch invalidation, identity isolation, and transport metrics must flow through the SAME enforcement as the existing HTTP boundary — a raw modern-SDK handler that bypasses these is a security regression, not a feature. Wire-level protocol-version assertions for stdio + HTTP, both eras.

**Touches:** src/mcp transport/handshake modules, sessionless HTTP path, test/mcp/protocol*, spec/mcp.md (protocol section)

## Acceptance
- [ ] SDK migrated; bun install --frozen-lockfile clean; all imports updated; full test suite green
- [ ] 2025-11-25 client golden test unaffected; 2026-07-28 client negotiates natively (wire assertions both transports)
- [ ] Sessionless path proven to enforce auth/write-gate/egress/admission identically to the legacy path (tests per guard)
- [ ] spec/mcp.md documents both negotiated revisions

- [ ] Negative negotiation: unsupported versions rejected with the spec'd error; missing/mismatched MCP-Protocol-Version header handled per spec; a legacy initialize NEVER yields a 2026 negotiation; 2026 `_meta` and `Mcp-Method`/`Mcp-Name` routing headers preserved end-to-end and malformed variants rejected, never silently stripped (tests for each)

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
