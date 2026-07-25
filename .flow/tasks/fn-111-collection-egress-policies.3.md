---
satisfies: [R2, R4, R7]
---
# fn-111-collection-egress-policies.3 Enforce policy at every current network-capable boundary

## Description
Deliver enforce policy at every current network-capable boundary as one implementation-sized increment.

**Size:** M
**Files:** `src/serve/server.ts`, `src/serve/routes/mcp.ts`, `src/mcp/http-security.ts`, `src/mcp/http-transport.ts`, `src/publish/export-service.ts`, `src/llm/httpEmbedding.ts`, `src/llm/httpGeneration.ts`, `test/egress/enforcement.test.ts`

### Approach
- Inventory and gate resident non-loopback serving, public/private publish handoff, remote embedding/rerank/generation, network export, redirects/fetch, and future remote agent paths before bytes leave the process.
- Require all participating collection policies plus the production `createMcpHttpGateway` / `HttpMcpSecurity` transport boundary; bearer authentication proves identity only, while HTTP MCP mutation remains separately gated by `gateway.enableWrite` / `--mcp-enable-write`. Keep clipper loopback local and public fn-103 projection derived only from explicitly remote-approved publication. <!-- Updated by plan-sync (cross-spec): fn-99-resident-local-context-gateway.5 finalized the gateway's distinct identity and write-authorization controls -->
- Make private/invite agent access remain unreachable until a separate auth gate and this evaluator both pass; never server-decrypt encrypted spaces.

### Investigation targets
**Required** (read before coding):
- `src/serve/server.ts`
- `src/serve/routes/mcp.ts`
- `src/mcp/http-security.ts`
- `src/publish/export-service.ts:347-390`
- `src/llm/httpEmbedding.ts`
- `src/llm/httpGeneration.ts`
- `src/llm/httpRerank.ts`

**Optional** (reference as needed):

**Planned dependency outputs** (expected by execution; not plan-time investigation sources):
- `src/mcp/http-transport.ts`
- `src/serve/routes/clipper.ts`
- `/Users/gordon/work/gno.sh/src/lib/publish-access.ts`

### Key context
- The inventory itself is a checked artifact/test: new network adapters must register an egress action or CI fails.

## Acceptance
- [ ] Every enumerated network-capable callsite evaluates policy before content/metadata transfer and returns stable EGRESS_DENIED details.
- [ ] Auth and policy intersection is required for non-loopback; neither alone is sufficient.
- [ ] Encrypted/private/deferred paths cannot be activated by configuration drift or undocumented routes.


## Done summary
Implemented and review-hardened fail-closed enforcement at every currently enumerated network-capable boundary.

- Added a checked AST callsite inventory for shipped TypeScript, TSX, JavaScript, and JSX. It detects direct, qualified, bracketed, imported, namespace-qualified, and aliased network/process primitives, including browser transports tied to their enforcing server boundary.
- Made every `LlmAdapter.create*Port` caller provide an explicit participating collection scope. Exact selected collections no longer inherit unrelated `local_only` restrictions; explicit `"all"` remains the only corpus-wide choice.
- Replaced inference hostname heuristics with bounded DNS-only classification before policy evaluation, followed by pinned preparation and an exact pre-request DNS recheck.
- Allowed policy-matched LAN hostnames only with homogeneous private answers. Mixed, public, special-use, proxy-unsafe, redirect-unsafe, and rebound destinations fail closed before inference bytes leave the process.
- Preserved independent HTTP MCP authentication/write authorization gates, stable redacted `EGRESS_DENIED` responses, and structurally disabled private/remote paths.
- Updated configuration and MCP contract documentation plus regression and evasion coverage.
## Evidence
- Commits: 281dd274, 856c9804
- Tests: bun test — 3397 pass, 2 expected skips, 0 fail, bun test test/egress/enforcement.test.ts — 17 pass, 0 fail, bun run lint:check — 0 warnings, 0 errors; 1823 files formatted, bun run docs:verify — 13 pass, 2 model-cache skips, 0 fail, bun run test:package — packed loopback serve, secured daemon, package sentinel passed, .flow/bin/flowctl validate --spec fn-111-collection-egress-policies --json — valid
- PRs: