# fn-112 task .1 repair round 2 (Grok 4.5)

- **Owner / model:** Grok 4.5
- **Session:** `019fb8d5-7418-7a11-963b-1a206a7af924`
- **Authoritative prior:** `.flow/reviews/fn-112-sol-impl-rereview-task-1.json` → **NEEDS_WORK** (I1-01…I1-03 closed; **I1-04 open**)
- **Round-1 I1-04:** marked **superseded_incomplete** in first repair receipt
- **Remaining gate:** independent Sol re-review round 3 — **no Sol SHIP claimed**
- **Task .2 SHIP:** preserved (`pdf.test.ts` 22 pass)

## I1-04 fix

### Production source of truth

New `src/serve/fn112-routes.ts`:

- `createDocAssetRouteHandlers` — GET+HEAD both go through `handleResidentRead` then `withSecurityHeaders` then `handleDocAsset`
- `createPdfjsVendorRouteMap` — worker/cMap/font GET+HEAD with `withSecurityHeaders`
- `dispatchPdfjsVendorRoute` — in-process dispatch (no port bind) for tests

`server.ts` mounts these factories only (no duplicated inline route maps).

### Production-route tests (`test/serve/fn112-production-routes.test.ts`)

**Doc-asset (shared factory):**

- Denied admit → **503** `UNAVAILABLE` on GET and HEAD
- Reader full → **429** `RATE_LIMITED` on GET and HEAD
- Full matrix 200/206/416 GET+HEAD with complete envelope (status, empty HEAD body, Content-Length, Content-Type, Cache-Control `no-store`, Accept-Ranges, Content-Disposition, Content-Range, CSP `worker-src 'self'` / `frame-ancestors 'none'` / `object-src 'none'` / no `unsafe-eval`, `X-Frame-Options: DENY`)
- GET vs HEAD header equality

**Vendor (shared factory, no port):**

- worker / cMap / font GET+HEAD: immutable cache, MIME, security, empty HEAD
- POST → **405** exact envelope
- Encoded traversal / multi-segment / invalid encoding / empty → **404** `NOT_FOUND` JSON only (never 400-or-404)

### Additional fix

`withSecurityHeaders` mutates headers **in place** so Bun `file.slice()` 206 bodies are not re-expanded (re-wrapping `response.body` re-reads the full file).

Handler-level adversarial tests in `api-doc-assets.test.ts` retained.

## Commands

```
bun test test/serve/fn112-production-routes.test.ts \
         test/serve/api-doc-assets.test.ts \
         test/serve/security.test.ts     → 42 pass
bun test test/serve/public/lib/pdf.test.ts → 22 pass
bun run lint:check / bunx tsc --noEmit / git diff --check / flowctl validate → 0
```

> **Audit note (round 3):** Sol rereview round3 found vendor error-path coverage used a test-only dispatcher not mounted by server.ts. Round-2 I1-04 vendor-fallback claim is **superseded_incomplete** — see `fn-112-grok-task-1-repair-round3`.
