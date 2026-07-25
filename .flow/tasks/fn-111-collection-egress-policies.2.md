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
Implemented and review-hardened conservative destination/network-zone classification plus DNS-pinned outbound HTTP seams.

- Added stable redacted classification for local process, loopback, private LAN/VPN, proven Tailscale IPv6, public, wildcard, provider, and unknown destinations across IPv4/IPv6, DNS answers, and explicit binds.
- Replaced public-by-default special-address handling with deterministic CIDR checks grounded in the IANA IPv4/IPv6 Special-Purpose Address Space registries refreshed 2025-10-09.
- Kept documentation, benchmark, shared, link-local, metadata, multicast, reserved/future-use, discard/dummy, local NAT64, 6to4, IPv4-compatible, mixed-answer, unresolved, malformed, and non-global IPv6 space fail-closed as remote/unknown.
- Preserved direct and IPv4-mapped loopback/private semantics, Tailscale classification, AWS IPv6 metadata denial, globally reachable NAT64 WKP translation of proven public IPv4, and ordinary public IPv4 plus IPv6 `2000::/3` controls.
- Made remote-provider identity conditional on homogeneous proven-public addresses; provider names or authentication no longer override destination classification.
- Added bounded Bun DNS resolution, exact pre-connection rechecks, IP-literal request pinning, original Host/SNI certificate verification, manual redirects, HTTPS downgrade and redirect-zone checks, provider-origin checks, HTTPS-only provider URLs, and restricted proxy-environment denial.
- Forced TLS certificate validation even when the process sets `NODE_TLS_REJECT_UNAUTHORIZED=0` or callers supply `rejectUnauthorized: false`, a custom identity callback, or a different SNI name.
- Isolated redirect enforcement from caller-visible state with a private immutable zone snapshot and recursively frozen classification projections.
- Validated public redirect counters as safe nonnegative integers, denied counts beyond the redirect limit before resolution, and emitted stable redacted denial projections for malformed counters.
- Replaced request-init spreading with an explicit safe allowlist, force-disabled Bun raw HTTP diagnostics, and stripped proxy/socket/S3/unknown runtime options from the pinned fetch boundary.
- Added an opaque connection object whose JSON/log projection excludes URLs, hostnames, addresses, credentials, and paths; successful responses scrub the pinned URL while preserving streaming, backpressure, status, body, headers, and manual redirect semantics.
- Normalized initial fetch errors and late response-stream read/cancel failures so raw pinned targets cannot escape through error messages, stacks, or JSON.
- Propagated one classifier result from the single Bun socket-peer sample through HTTP MCP authorization; forwarded headers remain ignored and stripped.
- Added table-driven provider denial fixtures across registered IPv4/IPv6 ranges, embedded/translated address fixtures, real public controls, mutation/diagnostic/counter/stream adversarial tests, and live local HTTPS verification.

Current HTTP model adapters remain unchanged intentionally; task 3 owns invoking this seam at every outbound callsite and intersecting it with collection policy.
## Evidence
- Commits: b46797e7, 3ba27107, 47e7f589, 78e6992d, 6a4d8d71
- Tests: bun test test/egress/destination-classifier.test.ts test/egress/destination-special-use.test.ts test/egress/destination-http-security.test.ts test/egress/http-policy-redaction.test.ts test/egress/policy.test.ts test/mcp/http-security.test.ts (45 pass, 0 fail), bun test test/egress test/mcp test/llm test/serve (769 pass, 0 fail), IANA registry matrix: documentation, benchmarking, shared/link-local, multicast, reserved/future-use, NAT64 local-use, 6to4, discard/dummy, mapped special IPv4, and non-global IPv6 literals all deny remote providers; Google/Cloudflare IPv4/IPv6 and public translated controls remain allowed, live local HTTPS fixture: pinned IP verified original model.test certificate, scrubbed successful Response.url, streamed the response body, and rejected wrong SAN despite process/caller TLS overrides, adversarial boundary fixtures: public classification mutation cannot bypass redirect enforcement; request diagnostics and unknown Bun options are stripped; invalid redirect counts deny before DNS; initial fetch and late body read/cancel failures expose no IP, hostname, path, query, or credentials, bun run lint:check (0 warnings, 0 errors; formatting current), .flow/bin/flowctl validate --spec fn-111-collection-egress-policies --json (valid, 0 errors, 0 warnings), git diff --check (clean)
- PRs: