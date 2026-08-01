# fn-112 task .5 repair (Grok 4.5) — Sol NEEDS_WORK B5-01..03

- **Owner:** Grok 4.5, sole writer
- **Task:** `fn-112-native-pdfjs-document-renderer.5`
- **Branch:** `feat/native-pdf-renderer`
- **Session:** `019fb8d5-7418-7a11-963b-1a206a7af924`
- **Prior Sol:** `.flow/reviews/fn-112-sol-impl-review-task-5.json` → **NEEDS_WORK**
- **Prior receipt:** `.flow/reviews/fn-112-grok-implementation-task-5.{md,json}` → **superseded_incomplete**
- **No Sol SHIP claimed**
- **Preserved:** tasks .1–.4 SHIP; valid task .5 work (lazy, notices, basename URL, classification)

## Dispositions

### B5-01 — predicate-false defense — **fixed**

`handlePdfFallback` now re-evaluates `isExtractedTextAvailable(doc)` from current `doc` before any state change. Predicate false → return without setting `pdfFallbackReason` or `showRawView`. Callback depends on `[doc]` (stable against stale predicate).

Non-vacuous test: for every false table row, spuriously click all four stub fallback reasons; assert **same `data-mount-id`**, no Text/not-available/no-extracted surfaces, zero `pdf-fallback-*`, pill still shows **Text** as target, no unmount log entry for that instance.

### B5-02 — real handleDocAsset bytes — **fixed**

New `test/serve/fn112-doc-asset-bytes.test.ts`:

| Seed | Store shape | On-disk file | Distinct payload |
| --- | --- | --- | --- |
| Nested | `relPath=nested/dir/report.pdf` | same | `PDF-NESTED-BYTES-α` |
| recordSourcePath | virtual `.gno/records/container/deadbeef.pdf` + `recordSourcePath=imports/real-source.pdf` | real source file | `PDF-RECORD-SOURCE-BYTES-β` |
| Container-backed | same convention as `record-container.ts` (virtual relPath under `.gno/records/container/…`, `recordSourcePath` → physical entry) | `container/pack/source.pdf` | `PDF-CONTAINER-BACKED-BYTES-γ` |
| Sibling dir1/dir2 | `dir1/report.pdf`, `dir2/report.pdf` | both | δ / ε distinct |

Uses real **SqliteAdapter** (`open` + `syncCollections` + `upsertDocument` + `getDocument`), real **Config**, production **`buildDocAssetUrl`**, real **`handleDocAsset`**. Asserts HTTP 200 + **byte-exact** body. Same-basename URIs return distinct bytes. Escape path → 403. Cross-dir path does not replace production basename URL for dir1.

**Container shape documented:** matches `src/ingestion/record-container.ts` — `relPath` is the virtual record path; `recordSourcePath` is the physical collection-relative source; `resolveAbsoluteDocPath` / API relPath use `recordSourcePath ?? relPath`.

### B5-03 — actual remount/navigation — **fixed**

Isolated lazy stub tracks module-level `stubMountSeq` + `stubMountLog` with `useEffect` mount/unmount; exposes `data-mount-id`. Resetters per test.

- Fallback → Text unmounts instance A; Pages remounts B with `B ≠ A`; notice cleared.
- App-equivalent navigation: `app.tsx` uses `pageKey = location` for `/doc` (`<Page key={pageKey} />`). Test remounts DocView with `key={/doc?uri=…}` A→B; asserts A unmounted, B mounted with B asset URL, no old fallback state.

## Changed files

- `src/serve/public/pages/DocView.tsx` — B5-01 guard
- `test/serve/public/pages/DocView.dom.test.tsx` — B5-01/B5-03 instrumentation + tests
- `test/serve/fn112-doc-asset-bytes.test.ts` — **new** B5-02 real-byte suite
- prior task-5 receipt marked superseded_incomplete

## Commands / results

| Command | Result |
| --- | --- |
| `bun test test/serve/public/pages/DocView.dom.test.tsx` | **14 pass** |
| `bun test test/serve/fn112-doc-asset-bytes.test.ts` | **1 pass** (byte-exact multi-shape) |
| focused PDF + hooks + lib + routes + security + DocView + bytes | **129 pass** |
| `bun run test:web` | **279 pass** |
| `bun run lint:check` | clean |
| `bunx tsc --noEmit` | clean |
| `git diff --check` | clean |
| Flow validate | valid |

## Remaining gate

Independent Sol **re-review** of task .5 repair. **No Sol SHIP claimed.**
