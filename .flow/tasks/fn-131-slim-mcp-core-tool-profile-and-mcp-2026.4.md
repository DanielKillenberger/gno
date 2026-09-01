---
satisfies: [R3, R6]
---
# fn-131-slim-mcp-core-tool-profile-and-mcp-2026.4 MCP SDK v2 migration (isolated)

## Description
The @modelcontextprotocol/sdk v1.30.0 → v2 migration in isolation, per the official upgrade-to-v2 guide (package split into several packages; manual behavioral adaptation beyond import rewriting). Scope: package.json + bun.lock, every sdk import site, scripts referencing the sdk, affected tests; legacy 2025-11-25 behavior preserved byte-for-byte (golden parity test BEFORE any 2026 feature work). No new features in this task — migration + parity only, so an iteration boundary can never leave a mixed v1/v2 tree with modern features half-attached. **Size:** L.

**Touches:** package.json, bun.lock, all @modelcontextprotocol/sdk import sites, scripts, affected tests

## Acceptance
- [ ] TBD

- [ ] bun install --frozen-lockfile clean post-migration; full suite green
- [ ] Legacy golden parity: pre/post tool-list + handshake byte-identical for a 2025-11-25 client
- [ ] No 2026-era feature code in this task's diff

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
