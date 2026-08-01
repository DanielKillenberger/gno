# fn-112 task .1 repair receipt (Grok 4.5) — ROUND 1 (I1-04 incomplete)

- **Owner / model:** Grok 4.5
- **Session:** `019fb8d5-7418-7a11-963b-1a206a7af924`
- **Branch:** `feat/native-pdf-renderer` @ `bb994b580356a41a31093fea85b06993c1a18e4c`
- **Prior review:** `.flow/reviews/fn-112-sol-impl-review-task-1.json` → **NEEDS_WORK**
- **Baseline:** `cap-001` (clean)
- **Task .2:** SHIP preserved
- **Superseded (I1-04 only):** `.flow/reviews/fn-112-grok-task-1-repair-round2.{md,json}`

## Dispositions I1-01 … I1-04

| ID | Status | Fix |
| --- | --- | --- |
| **I1-01** | fixed | Independent package-root realpath; subdir containment; immutable cache |
| **I1-02** | fixed | HEAD `/api/doc-asset` via resident admission + security headers |
| **I1-03** | fixed | Multi-range → 416 + `bytes */size` |
| **I1-04** | **SUPERSEDED / INCOMPLETE** | Round-1 used direct handlers + copied Bun.serve map. Sol rereview required production route factories. Fixed in **round 2**. |

> **Audit note:** Sol `fn-112-sol-impl-rereview-task-1` closed I1-01…I1-03 in implementation and left I1-04 open because tests did not exercise production route registration/admission. Round-1 I1-04 claim is incomplete.

## Commands (as of round 1)

```
bun test test/serve/api-doc-assets.test.ts test/serve/security.test.ts  → 38 pass
bun test test/serve/public/lib/pdf.test.ts                              → 22 pass
bun run lint:check / bunx tsc --noEmit / git diff --check / flowctl validate → 0
```
