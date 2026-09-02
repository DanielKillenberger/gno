---
satisfies: [R2]
---
# fn-136-pdf-viewing-over-a-remote-link.4 First paint from page 1 geometry

## Description
Implement R2. Publish page slots as soon as page 1 geometry resolves, use page 1 dimensions as the placeholder for unmeasured pages, correct slots and fit scale when the full geometry pass lands, and keep already-rendered pages mounted when a later page's geometry fails. Depends on task .3: its relay measurement is the gate that decides whether client-side rendering stays the approach.

**Size:** M
**Files:** `src/serve/public/hooks/use-pdf-pages.ts`, `src/serve/public/components/pdf/PdfViewer.tsx`, `test/serve/public/hooks/use-pdf-pages.dom.test.tsx`, `test/serve/public/components/pdf/PdfViewer.dom.test.tsx` (or the existing PdfViewer test file if one exists under `test/serve/public/components/pdf/`)
**Touches:** [src/serve/public/hooks/use-pdf-pages.ts, src/serve/public/components/pdf/PdfViewer.tsx, test/serve/public/hooks/use-pdf-pages.dom.test.tsx, test/serve/public/components/pdf/**]

### Approach
- In the geometry effect (`src/serve/public/hooks/use-pdf-pages.ts:290-401`) resolve page 1 first, publish slots with page 1 width and height for every page, compute the fit scale from page 1, then let the 4-worker pass continue and republish with real sizes and the recomputed `maxWidth`/`maxHeight` scale in one commit. Keep the per-document geometry cache (`geometryCacheRef`) holding the full pass only, and say so in a code comment.
- Preserve the scroll anchor of the page in view when slot heights change: adjust the scroll position by the height delta of the pages above it, following the existing slot and visibility model (`syncSlotWindow` `:276-288`, `computeActiveSet`).
- Split the hook's error state into a fatal error (page 1 geometry or document-level failure, current behaviour) and a nonfatal later-page geometry error carried on the affected slot. `PdfViewer.tsx` today renders pages only while `viewerError === null` (`PdfViewer.tsx:188`, `:389-390`), so any hook error unmounts every page. Change the viewer so only the fatal error takes the fallback path; a nonfatal error keeps existing slots mounted and surfaces the page error state on the failed slot. Add `PdfViewer.tsx` tests for both paths.
- Rewrite the existing all-or-nothing geometry test ("mixed-size geometry and fit modes use every page without eager canvas renders", `use-pdf-pages.dom.test.tsx` about line 1520) rather than working around it; add cases with deferred `getPage` promises so page 1 resolves first, mixed-size fixtures settle to correct heights, fit-width recomputes against the widest page, and the scroll anchor holds.

### Investigation targets
**Required** (read before coding):
- `src/serve/public/hooks/use-pdf-pages.ts:276-401` — slot window and geometry effect
- `src/serve/public/components/pdf/PdfViewer.tsx:180-205` and `:380-400` — viewerError derivation and the progressive/error gating
- `test/serve/public/hooks/use-pdf-pages.dom.test.tsx:1500-1620` — mixed-size geometry test and deferred promise helpers

**Optional** (reference as needed):
- `src/serve/public/components/pdf/PdfViewer.tsx:140-200` — container measurement and fit mode reset
- `src/serve/public/components/pdf/PdfPageView.tsx:70-140` — placeholder and canvas mount

### Key context
- The fit scale currently depends on max dimensions across all pages, so a page-1-only publish needs a second scale commit; a scale change already cancels and re-renders in-flight pages (`use-pdf-pages.ts:793-800`).
- Placeholder correctness is part of the scroll model (comment at `use-pdf-pages.ts:290-292`); the correction must not make the page in view jump.
- The current effect is all-or-nothing: it throws and blanks every slot when `resolved.length !== numPages` or any `getPage` fails. R2 replaces that invariant deliberately.
## Acceptance
- [ ] Slots publish and page 1 renders before later pages' geometry resolves
- [ ] Mixed-size documents settle to correct per-page heights; fit-width and fit-page recompute against the widest measured page in one commit
- [ ] The top edge of the page in view stays fixed when later heights land (test asserts the scroll adjustment)
- [ ] A later-page geometry failure keeps already-rendered pages mounted and shows the page error on the failed slot; a page 1 or document-level failure still takes the existing fallback path (PdfViewer tests for both)
- [ ] The all-or-nothing geometry test is rewritten; existing use-pdf-pages and PdfViewer tests pass; `bun test` and `bun run lint:check` pass
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
