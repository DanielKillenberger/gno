---
satisfies: [R2, R4, R7]
---
# fn-111-collection-egress-policies.2 Build conservative destination and network-zone classification

## Description
Deliver build conservative destination and network-zone classification as one implementation-sized increment.

**Size:** M
**Files:** `src/core/destination-classifier.ts`, `src/mcp/http-security.ts`, `src/llm/http-policy.ts`, `test/egress/destination-classifier.test.ts`

### Approach
- Classify loopback/LAN/VPN-Tailscale/public/provider destinations across hostname, IPv4/IPv6, DNS answers, redirects, and explicit bind interfaces.
- Resolve and pin/recheck DNS per connection/redirect, reject mixed/public answers for restricted policy, and ignore forwarded proxy headers unless a future explicit proxy trust mode exists.
- Return conservative unknown/public when network state cannot be proven; do not treat a friendly hostname or auth token as LAN.

### Investigation targets
**Required** (read before coding):
- `src/mcp/http-security.ts`

<!-- Updated by plan-sync (cross-spec): fn-99-resident-local-context-gateway.3 changed the HTTP gateway boundary module from src/serve/security.ts to src/mcp/http-security.ts -->
- `src/llm/httpEmbedding.ts`
- `src/llm/httpGeneration.ts`
- `src/llm/httpRerank.ts`
- `src/serve/server.ts`

**Optional** (reference as needed):
- `src/app/constants.ts`
## Acceptance
- [ ] Loopback/private/public/VPN/Tailscale/IPv4/IPv6/DNS-rebinding/redirect/proxy fixtures classify conservatively.
- [ ] TOCTOU or mixed DNS/redirect changes cannot upgrade a restricted decision.
- [ ] Classifier output and logs are stable/redacted and contain no credential or sensitive path.


## Done summary
Implemented conservative destination and network-zone classification plus DNS-pinned outbound HTTP seams.

- Added stable redacted classification for local process, loopback, private LAN/VPN, proven Tailscale IPv6, public, wildcard, provider, and unknown destinations across IPv4/IPv6, DNS answers, and explicit binds.
- Kept shared CGNAT, IPv4 link-local/metadata, mixed answer classes, unresolved names, malformed answers, and friendly hostnames fail-closed as remote/unknown.
- Added bounded Bun DNS resolution, exact pre-connection rechecks, IP-literal request pinning, original Host/SNI certificate verification, manual redirects, HTTPS downgrade and redirect-zone checks, provider-origin checks, and restricted proxy-environment denial.
- Added an opaque connection object whose JSON/log projection excludes URLs, hostnames, addresses, credentials, and paths.
- Propagated one classifier result from the single Bun socket-peer sample through HTTP MCP authorization; forwarded headers remain ignored and stripped.
- Added adversarial unit/integration fixtures plus a live local HTTPS test proving IP rewrite with the original DNS certificate.

Current HTTP model adapters remain unchanged intentionally; task 3 owns invoking this seam at every outbound callsite and intersecting it with collection policy.
## Evidence
- Commits: b46797e7
- Tests: bun test test/egress/destination-classifier.test.ts test/egress/policy.test.ts test/mcp/http-security.test.ts (36 pass, 0 fail), bun test test/egress test/mcp test/llm test/serve (760 pass, 0 fail), live local HTTPS fixture: pinned IP request verified original model.test certificate via SNI and preserved Host, bun run lint:check (0 warnings, 0 errors; formatting current), .flow/bin/flowctl validate --spec fn-111-collection-egress-policies --json (valid, 0 errors, 0 warnings), git diff --cached --check (clean before commit)
- PRs:
