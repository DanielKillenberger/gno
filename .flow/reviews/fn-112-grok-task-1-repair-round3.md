# fn-112 task .1 repair round 3 (Grok 4.5)

- **Prior Sol:** `.flow/reviews/fn-112-sol-impl-rereview-task-1-round3.json` → **NEEDS_WORK** (I1-01…03 closed; **I1-04** open)
- **Round-2 I1-04:** marked **superseded_incomplete** (test-only dispatcher)
- **Remaining gate:** independent Sol re-review round 4 — **no Sol SHIP claimed**
- **Task .2 SHIP:** preserved (`pdf.test.ts` 22 pass)

## Fix (I1-04)

### Single production vendor dispatcher

`handlePdfjsVendorRequest(request, { isDev, withSecurityHeaders })` is the **only** production path for every `/vendor/pdfjs/*` request (any method, any path under the prefix).

**server.ts (production mount):**
- Removed `...createPdfjsVendorRouteMap(...)` valid-only mounts from the routes object
- `Bun.serve` `fetch` claims `isPdfjsVendorPath(pathname)` → `handlePdfjsVendorRequest` (identical function tests call)
- Covers valid worker/cMap/font **and** malformed/unknown/empty/multi-segment/POST

**ALL responses** (200/404/405) pass through `withSecurityHeaders` **once** (inner response built first; no double-wrap).

### Exact envelopes (asserted full object, not merely code)

| Status | Body |
| --- | --- |
| **405** | `{ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD are supported" } }` |
| **404** | `{ error: { code: "NOT_FOUND", message: "Asset not found" } }` |

Plus full security headers on every response:
- CSP: `worker-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, no `unsafe-eval`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Resource-Policy: same-origin`
- `X-Content-Type-Options: nosniff`
- Error bodies: `Content-Type: application/json`

### Tests (`test/serve/fn112-production-routes.test.ts`)

Call `handlePdfjsVendorRequest` with the same `{ isDev: false, withSecurityHeaders }` options server uses — no port bind, no separate test dispatcher:
- Success GET/HEAD worker/cMap/font (immutable, MIME, empty HEAD, Content-Length)
- POST valid path → exact 405 + security headers
- Encoded traversal / multi-segment / empty / invalid encoding / unknown / invalid extension → exact 404
- Doc-asset production admission/matrix preserved
- Handler-level adversarial tests preserved (`api-doc-assets.test.ts`)

### I1-01…03 / task .2

Preserved closed; task .2 SHIP unchanged.

## Commands (verified this pass)

```
bun test …fn112-production + api-doc-assets + security  → 45 pass
bun test test/serve/public/lib/pdf.test.ts             → 22 pass
bun run lint:check / bunx tsc --noEmit / git diff --check / flowctl validate → 0
```
