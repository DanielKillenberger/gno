# fn-112 task .2 repair round 2 (Grok 4.5)

- **Owner / model:** Grok 4.5
- **Session:** `019fb8d5-7418-7a11-963b-1a206a7af924`
- **Branch:** `feat/native-pdf-renderer` @ `bb994b580356a41a31093fea85b06993c1a18e4c`
- **Authoritative prior review:** `.flow/reviews/fn-112-sol-impl-rereview-task-2.json` → **NEEDS_WORK** (I2-1…I2-5 resolved; I2-6/I2-7 blocking)
- **First repair:** `.flow/reviews/fn-112-grok-task-2-repair.*` — **I2-6 and I2-7 claims marked `superseded_incorrect`**
- **Remaining gate:** independent Sol re-review round 3 — **no Sol SHIP claimed**

## I2-6 fixed (genuine successful dual loads)

1. **No caller `docId`** — `GnoGetDocumentParams` is `{ url }` only; `getDocument()` always mints `gnoDocId` internally.
2. **`t` = `performance.now()`** directly (not elapsed-from-t0). `t0Epoch` + `t0Perf` still enable wall-clock mapping.
3. **Real dual loads** of checked-in `viewer-links.pdf` via a distinctive temp-path copy:
   - `await` both `loadingTask.promise` → `numPages === 5`
   - page-1 text includes `KNOWN_GLYPH_RUN_ALPHA the quick brown fox`
   - annotations include `https://example.com/gno-pdf-viewer` and `javascript:`
   - two facade `gnoDocId`s are distinct opaque `dN` values
   - smuggled `docId: "caller-controlled-id"` does **not** become `gnoDocId`
4. **Privacy:** secret temp path / filename / title / known content / external URL do not appear in metrics export.
5. **Worker setup:** browsers keep `GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs"`; under `typeof Bun !== "undefined"` tests resolve package-local worker/cMap/standard_fonts via `import.meta.resolve`. No mocked `getDocument`, no swallowed expected failures.
6. **Timestamp tests** assert `t` falls in a live `performance.now()` window; deep-freeze tests retained.

## I2-7 fixed (truthful evidence)

- Round-1 repair receipt explicitly supersedes false I2-6/I2-7 claims.
- This round-2 receipt is the current authoritative repair evidence.
- `flowctl done` + task JSON status reconciled after gates pass.

## Commands

```
bun test test/serve/public/lib/pdf.test.ts  → 22 pass, 0 fail
bun run lint:check                          → exit 0
bunx tsc --noEmit                           → exit 0
git diff --check                            → exit 0
.flow/bin/flowctl validate --spec fn-112-…  → valid: true
```

## Changed files (this round)

- `src/serve/public/lib/pdf.ts`
- `test/serve/public/lib/pdf.test.ts`
- `.flow/reviews/fn-112-grok-task-2-repair.{md,json}` (supersession marks)
- `.flow/reviews/fn-112-grok-task-2-repair-round2.{md,json}`
