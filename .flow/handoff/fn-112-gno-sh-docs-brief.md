# fn-112 — Hosted-site (`gno.sh`) documentation execution record

## Outcome

Hosted documentation implemented in `/Users/gordon/work/gno.sh` on branch
`codex/native-pdf-viewer-docs` and opened as
[`gmickel/gno.sh#26`](https://github.com/gmickel/gno.sh/pull/26).

Production deployment remains pending that PR's merge. No deployment was attempted.

## Changed surfaces

- `src/lib/gno-docs.tsx`
  - Web UI reference: native PDF pages, Pages/Text toggle, local/offline assets,
    controls, conditional extracted-text fallback, no-text error state, and limits.
  - API reference: `GET`/`HEAD /api/doc-asset`, single-range behavior, and
    same-origin `/vendor/pdfjs/*` assets.
- `src/lib/product-pages.ts`
  - Web UI benefit and FAQ updated without claiming binary editing.
- `src/lib/site-content.ts`
  - Browse showcase updated for native PDF pages and extracted-text fallback.
- `src/lib/product-pages.test.ts`
- `src/lib/public-truth-content.test.ts`
  - Regression coverage for the public claims and read-only boundary.

## Verification

- `bun install --frozen-lockfile`
- `bun x ultracite fix`
- `bun run check`
- `bun run typecheck`
- `bun run build` — 92 routes prerendered
- `bun test` — 130 pass, 7 environment-dependent skips, 0 fail
- Local browser QA at `http://localhost:3344`:
  - `/docs/web-ui#native-pdf-viewer`
  - `/docs/api`
  - `/features/web-ui`
  - `/faq` with the PDF question expanded
  - desktop and 390 px mobile layouts
  - code-copy control
  - no browser console errors

Evidence screenshots are retained in
`.flow/reviews/fn-112-task-7-site-evidence/` in the GNO PR branch.

## After merge

Deploy from `/Users/gordon/work/gno.sh` using the repository runbook, then verify:

1. `curl -fsSI https://gno.sh`
2. `ssh root@178.104.180.89 "systemctl is-active gno-sh"`
3. remote `/srv/gno-sh/repo` HEAD equals `origin/main`
4. drive the four changed public pages once more on `https://gno.sh`

Post-merge deployment is deliberately not claimed by this record.
