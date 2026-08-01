---
satisfies: [R1, R9, R19]
---
# fn-112-native-pdfjs-document-renderer.5 Integrate the PDF viewer into DocView with Pages/Text toggle and fallback

## Description
Wire the viewer into `DocView`: the `isPdf` branch, the `Pages`/`Text` toggle reusing the existing `showRawView` wiring (so deep links keep meaning), the scanned-PDF "no extracted text" sub-state, and the download/open-original secondary action.

**Size:** S
**Files:** `src/serve/public/pages/DocView.tsx`, `test/serve/public/pages/DocView.dom.test.tsx`

### Approach
- Classification: `isPdf` = `source.mime.toLowerCase() === "application/pdf"` or `source.ext.toLowerCase() === ".pdf"` — alongside the existing `isMarkdown`/`isCodeFile` branches (`DocView.tsx:400-423`). Non-PDF paths must remain behaviorally untouched.
- Asset URL: `/api/doc-asset?uri=<doc.uri>&path=<relative path>` — the spike derived `path` as the last segment of `doc.relPath` (see its DocView diff in `/tmp/gno-native-pdf-investigation`, evidence only, no iframe). **Validate that derivation before adopting it (N5):** `basename(relPath)` is only correct if the endpoint resolves `path` relative to the document's own directory. Check the resolution semantics in `handleDocAsset` and exercise the derivation against (a) a nested document (`relPath` with directories), (b) a `recordSourcePath`-backed document, and (c) a container-backed document, plus (d) a fixture where a sibling directory holds a file with the SAME basename. If basename cannot uniquely resolve the indexed PDF in any of those cases, use the full `relPath` (or the recorded source path) instead and document the choice here. Tests must prove the derived URL resolves the actual indexed PDF and cannot select a coincident-filename sibling.
- Toggle: reuse `showRawView` — `false` = Pages (PdfViewer), `true` = Text (existing extracted-text `<pre>` branch). The existing effect at `DocView.tsx:436-440` (forces raw view for `view=source`/`lineStart`) then gives PDF deep links the correct Text-view landing for free (spec R19). The floating pill (pattern at `:1583-1607`) shows `Pages`/`Text` labels for PDFs; markdown's Source/Rendered pill is untouched.
- Lazy-load `PdfViewer` via `lazy()` + `Suspense` (pattern: `src/serve/public/pages/GraphView.tsx:1-38`) so pdfjs never loads for non-PDF docs.
- **Fallback data flow (explicit, DocView-owned — this is the whole P7 contract):** `DocView` holds `pdfFallbackReason: PdfFallbackReason | null` (type imported from `lib/pdf.ts`). It computes `extractedTextAvailable` with the spec's exact predicate — `doc.contentAvailable === true && typeof doc.content === "string" && doc.content.trim().length > 0` (fields at `DocView.tsx:78-92`; evaluated per render, never cached, never derived from mime/ext) — and passes it plus `onFallback` to `PdfViewer`; `onFallback(reason)` sets `showRawView = true` **and** stores the reason in one update. The Text branch renders the persistent inline notice above the extracted text using the spec's **"Canonical fallback-notice copy"** table verbatim — eyebrow, body, single `Download original` action, and hook `pdf-fallback-<reason>` — one distinct string each for `corrupt`, `password`, `network`, `bootstrap`, and no implementer-authored copy. The `corrupt` notice is the approved register string byte-exact: `This PDF could not be rendered. View the extracted text or download the original.` (this is the only place that string appears; the viewer's own corrupt card carries the no-extracted-text variant from the spec's "Canonical state copy" table). The notice carries no retry control — switching back to `Pages` via the existing pill is the retry path and is also what clears the notice. `DocView` remains the single owner of the `Pages`/`Text` control via the existing `showRawView` floating pill — `PdfToolbar` renders no view toggle (spec "View-toggle ownership", R19). The notice persists while the user reads the Text view; it clears when the user manually toggles back to `Pages` (which remounts/retries the viewer). `PdfViewer` only calls `onFallback` when `extractedTextAvailable` is true, so the no-extracted-text case never silently lands on an empty Text view — the viewer's own error card stays visible and actionable there.
- Empty extracted text: when `doc.contentAvailable` is true but extracted content is empty/whitespace-only, the Text branch shows the explicit "No extracted text for this document." sub-state (distinct from the existing not-available card at `:1609-1615`). Such a document fails the `extractedTextAvailable` predicate, so **no fallback can ever fire for it**: the sub-state is reachable only by manual `Text` selection, is never accompanied by a fallback notice, and the combined case is not a requirement (the earlier "notice + empty sub-state together" wording was unreachable and is removed). On `Pages` the viewer keeps its own error card, actionable with `Try again` + `Download original`.
- Download action: keep/extend the existing header actions; ensure a download/open-original affordance exists for PDFs (asset URL with browser-native download or the existing `file://` Open original at `:1440-1449`) — PdfViewer also receives `downloadUrl`.
- Preserve: overview card (`lg:hidden`, `:1578`), rails, tag editing, publish export, Reveal — all keep working for PDFs (they key off `doc`, not content type).
- Extend `DocView.dom.test.tsx` with `mock.module` of the PdfViewer module (a stub that exposes a way to fire `onFallback` with a chosen reason): PDF doc renders stub + Pages/Text pill; `view=source` deep link lands on Text; toggle switches branches; **all four fallback reasons flip to Text and render their own distinct notice** (string-exact against the canonical table, correct `pdf-fallback-<reason>` hook, exactly one `Download original` control and no retry control); toggling back to Pages clears the notice; the predicate itself table-tested — `{contentAvailable:false}`, `{contentAvailable:true, content:null}`, `{content:""}`, `{content:"   \n\t"}` all yield `false` (no fallback, viewer keeps its error card) and `{contentAvailable:true, content:"text"}` yields `true`; empty-extracted-text sub-state reached by manual Text selection with **no** fallback notice present (assert zero `[data-testid^="pdf-fallback-"]` nodes) and the download affordance still reachable; asset-URL derivation cases from the N5 list; non-PDF snapshots unchanged.

### Investigation targets
**Required:**
- `src/serve/public/pages/DocView.tsx:289, 319-336, 400-453, 1578-1660` — state, deep-link target, branches, content well
- `test/serve/public/pages/DocView.dom.test.tsx` — existing mocks to extend
- `src/serve/public/lib/deep-links.ts` — parse/build deep link semantics

**Optional:**
- `src/serve/public/pages/GraphView.tsx:1-38` — lazy/Suspense pattern

### Design context
- The Pages/Text pill uses the exact floating-pill treatment (mono 11px, `bg-background/80 backdrop-blur`, inline-style absolute positioning per ADR-001 — not Tailwind `right-3`/`top-3`).
- The viewer sits in the existing content-inner recessed well; breadcrumbs and header unchanged.

### Key context
- `currentTarget`/`currentUri` are memoized once per mount and App remounts the page on route changes — verify (don't assume) that back/forward between two PDF URLs remounts DocView so task .3's unmount cleanup runs; if a non-remount path exists, key the viewer on `doc.uri`.

### Acceptance
- [ ] PDF docs render the lazy-loaded PdfViewer in the content well; no iframe/object/embed in the DOM; non-PDF rendering paths byte-identical in behavior (existing DOM tests untouched and green)
- [ ] Pages/Text pill toggles branches; `view=source` and `lineStart` deep links land on Text; markdown Source/Rendered unaffected (DOM tests)
- [ ] `pdfFallbackReason` state exists on DocView and is set by `onFallback(reason)` together with `showRawView=true`; each of the four reasons renders its own persistent notice above the extracted text, string-exact against the spec's "Canonical fallback-notice copy" table with hook `pdf-fallback-<reason>` and exactly one `Download original` control (no retry control); at most one `pdf-fallback-*` node exists at a time; the notice clears on manual toggle back to Pages (DOM tests for all four)
- [ ] `extractedTextAvailable` implements the spec predicate exactly (`doc.contentAvailable === true && typeof doc.content === "string" && doc.content.trim().length > 0`) and is table-tested over `contentAvailable:false` / `content:null` / `""` / whitespace-only / non-empty; predicate false → no fallback occurs and the viewer's error card stays visible and actionable; the "No extracted text for this document." sub-state renders only on manual Text selection, with zero `pdf-fallback-*` nodes present and the download affordance reachable (DOM tests)
- [ ] Asset-URL derivation validated against nested `relPath`, `recordSourcePath`-backed, and container-backed documents, plus a same-basename sibling — the derived URL resolves the actual indexed PDF and cannot select the sibling (DOM/unit tests); the chosen derivation is documented in the done summary
- [ ] Download/open-original affordance present for PDFs; viewer remount-on-navigation verified (test or documented manual check)
- [ ] `bun test test/serve/public/pages/DocView.dom.test.tsx` green; `bun run test:web`, lint, typecheck: no new failures vs the durable baseline receipt `.flow/reviews/fn-112-baseline-receipt.json` (task .2 step 0)

## Acceptance
- [ ] isPdf branch renders lazy PdfViewer; non-PDF behavior unchanged; no iframe/object/embed
- [ ] Pages/Text reuses showRawView; source/lineStart deep links land on Text (R19)
- [ ] DocView-owned `pdfFallbackReason` flow tested for all four reasons with string-exact canonical notice copy, `pdf-fallback-<reason>` hooks, notice clearing, the exact `extractedTextAvailable` predicate (table-tested), and the no-extracted-text actionable case — the scanned/empty sub-state never co-occurring with a notice
- [ ] Asset-URL derivation proven correct for nested/recordSourcePath/container docs and a same-basename sibling
- [ ] Download/open-original affordance for PDFs; remount-on-navigation verified
- [ ] DocView DOM suite + test:web + lint + typecheck: no new failures vs the durable baseline receipt `.flow/reviews/fn-112-baseline-receipt.json`


## Done summary
# fn-112.5 repair — B5-01..03

- **B5-01:** handlePdfFallback guards extractedTextAvailable; spurious false callbacks keep same mount id, no Text/notice.
- **B5-02:** Real SqliteAdapter + handleDocAsset byte-exact nested/recordSourcePath/container/sibling suite.
- **B5-03:** Stub mount identities; Text→Pages B≠A; App key={location} A→B remount with B URL, notice cleared.

Prior receipt superseded_incomplete. Repair: `.flow/reviews/fn-112-grok-implementation-task-5-repair.{md,json}`. **No Sol SHIP.**
## Evidence
- Commits:
- Tests: bun test DocView.dom → 14 pass (B5-01/B5-03), bun test fn112-doc-asset-bytes → 1 pass (B5-02), focused pdf+hooks+routes+security+DocView+bytes → 129 pass, bun run test:web → 279 pass, lint:check / tsc / diff-check → clean
- PRs: