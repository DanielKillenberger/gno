# fn-112-native-pdfjs-document-renderer — Opus plan repair

- **Owner**: Opus 5 (sole planner/spec owner for the remaining revisions of this spec)
- **Canonical model expected**: `claude-opus-5` (orchestrator verifies structured `modelUsage`; no observation claimed here)
- **Stage**: plan-repair (continuation of the quota-failed Fable revision)
- **Spec**: `fn-112-native-pdfjs-document-renderer`
- **Base / HEAD**: `bb994b580356a41a31093fea85b06993c1a18e4c` (unchanged)
- **Gate state after this pass**: `plan_review_status = needs_work` — **not** approved, **not** SHIP, **not** ready
- **Implementation performed**: none (planning artifacts only)

The prior Fable pass revised the spec and tasks .1/.2 and part of .3 before returning
HTTP 429. Those edits were preserved where sound; every artifact was independently
re-read and finished. The frontend-design plugin was invoked before finalizing the
UI/design and browser-evidence requirements; the pinned Scholarly Dusk direction
(ADR-001) was preserved — no new palette, type roles, or signature element was
introduced, and boldness stays spent on the single instrument-rail element.

## Blocking findings — P1–P8

| ID | Finding | Disposition | Where repaired |
| --- | --- | --- | --- |
| P1 | Impossible import rule: task .3 required `TextLayer` from `pdfjs-dist` while forbidding any pdfjs-dist import outside `lib/pdf.ts` | **Resolved** — one coherent facade. `lib/pdf.ts` exports the full runtime/type/classifier surface (`TextLayer`, `getDocument` wrapper, `classifyPdfError`, `isRenderingCancelled`, `PdfFallbackReason`, `PDFDocumentProxy`/`PDFPageProxy`/`RenderTask`/`PageViewport`/annotation types) and `__gnoPdfMetrics`; `PdfPageView` imports `TextLayer` from `../lib/pdf`; "extend the facade, never import pdfjs-dist here" is stated; `rg` single-import assertion is an acceptance item in both .2 and .3 | spec Architecture table; task .2 Approach + Acceptance; task .3 Approach + Acceptance |
| P2 | Non-executable order: .1 tested pdfjs routes before .2 added the dependency | **Resolved** — order is `.2 → .1 → .3 → .4 → .5 → .6 → .7`. Task .2 step 0 records the clean-upstream baseline on the untouched tree at `bb994b58` **before** `bun add`; .1 consumes the already-pinned, lockfile-tracked dependency with no local install or hand-off. Reflected identically in JSON `depends_on` and in the MD "Execution order" section | spec Execution order; task .1/.2 Description + Approach; all seven task JSONs |
| P3 | No genuine cMap / non-embedded-font fixture; route-200 is not proof | **Resolved** — deterministic checked-in `standard-font.pdf` (base-14, no `FontFile` stream) and `cjk-cmap.pdf` (Type0, `/Encoding /UniJIS-UCS2-H`, non-embedded CID) generated in .2; .6 requires, in a clean non-intercepted run, a non-blank canvas **and** a successful (200, non-empty body) same-origin request to `/vendor/pdfjs/standard_fonts/…` and `/vendor/pdfjs/cmaps/….bcmap`, plus zero non-`self` requests over the whole run, with resolved asset filenames recorded in the evidence artifact | spec Performance-budget fixtures + R3; task .2 Approach/Acceptance; task .6 Approach/Acceptance |
| P4 | Browser evidence incomplete (alignment, R8 states, mobile card/rails) | **Resolved** — .6 defines two separated run modes (clean vs `page.route()` interception); all seven R8 states driven deterministically (delayed doc-asset → loading; delayed ranges on the 200-page fixture → progressive; `zero-page.pdf` → empty; corrupt; password; aborted doc-asset → network; 404-fulfilled worker AND cmap AND standard-font → three bootstrap sub-cases); alignment screenshots + selection-vs-glyph overlap assertions at 100% / fit-width / 200%; dark + light × ~1380 px and ~900 px including the `lg:hidden` overview card and all three rails asserted (not merely screenshotted); task .4 adds stable per-state test hooks so the states are drivable without racing | task .4 Key context + Acceptance; task .6 Approach + Acceptance; spec R15/R18 |
| P5 | Performance acceptance not implementable (no P-3 number, no p95 protocol, post-unmount counter) | **Resolved** — P-3: 200-page fixture at 100%, programmatic scroll top→bottom in viewport-height steps at one step per 50 ms then 2 s settle, assert total `renderStart` **≤ 60** and zero orphaned starts. P-4: 20 alternating 100%↔200% commits, sample = commit → last visible `renderSettle(completed)`, p95 = 19th of the ascending-sorted 20, ≤ 500 ms, plus cancel-before-restart ordering. Instrumentation is a module-level `__gnoPdfMetrics` owned by `lib/pdf.ts` and attached once to `globalThis` — never component state — recording `renderStart`/`renderCancel`/`renderSettle`/`pageCleanup`/`documentDestroy`; P-6 asserts `documentDestroy` plus zero new `renderStart` in a 1 s post-navigation window. Documented in `docs/WEB-UI.md` as an unstable diagnostic surface, not an API contract | spec P-3/P-4/P-6; task .2 (channel), .3 (recording + unmount-survival test), .6 (assertions), .7 (docs note) |
| P6 | Contradictory StrictMode invariant | **Resolved** — the invariant is now stated precisely: two `getDocument` calls under dev StrictMode are expected and permitted; (a) the first task is `destroy()`ed promptly by its own cleanup, (b) at most one *undestroyed* task survives, (c) no state write lands from a destroyed/stale task (guard on `loadingTask.destroyed` + monotonic effect-generation token), (d) the same token covers URL-change and retry races. Tests use manually settleable deferred promises so the superseded promise settles **last** in both race shapes | spec Compatibility constraints; task .3 Approach + Acceptance |
| P7 | Fallback contract incomplete — no state carried the notice into DocView's Text branch | **Resolved** — explicit DocView-owned flow: `PdfViewer` receives `{extractedTextAvailable, onFallback}`; `onFallback(reason: PdfFallbackReason)` fires once per failed load only when extracted text exists; DocView owns `pdfFallbackReason` and sets it together with `showRawView = true`, rendering a persistent reason-specific notice (four distinct strings) above the extracted text with an adjacent download action; the notice clears on manual toggle back to Pages. When extracted text is unavailable `onFallback` is **not** called and the viewer's error card stays actionable (retry + Download original); the combined "No extracted text" sub-state keeps the download reachable. Tests required for all four reasons and both directions | spec Frontend contract + R9; task .4 Approach/Acceptance; task .5 Approach/Acceptance |
| P8 | Hosted gno.sh docs deferred as a vague note vs. AGENTS.md same-change requirement | **Reconciled within the user's explicit single-repository / no-publication boundary.** `/home/claw/work/gno.sh` is **not** added to the plan and must not be touched, cloned, edited, gated, or deployed. In-repo documentation is made complete (`docs/API.md`, `docs/WEB-UI.md`, `src/serve/CLAUDE.md`, `website/_data/features.yml`, `CHANGELOG.md`, `docs:verify`) and is the full documentation deliverable. Task .7 additionally produces a ready-to-apply in-repo brief at `.flow/handoff/fn-112-gno-sh-docs-brief.md` (exact gno.sh files, drafted copy, rationale, Live-QA checklist for local drive at `:3344` and post-deploy verification). The hosted-site source/deploy is recorded explicitly as an **external post-merge owner handoff** and explicitly **not a completion dependency** of this spec. No artifact claims hosted docs were updated, QA'd, or deployed — an acceptance item asserts exactly that | spec Boundaries + R16; task .7 Approach + Acceptance |

## Non-blocking observations — N1–N7

| ID | Disposition | Where |
| --- | --- | --- |
| N1 | **Incorporated** — GET **and** HEAD tests required per `/vendor/pdfjs/` route (HEAD returns matching headers, empty body); also carried into the package smoke | task .1 Approach/Acceptance; task .6 package-smoke item |
| N2 | **Incorporated** — realpath containment canonicalizes **both** the configured root and the candidate; only candidate `ENOENT` falls back to the lexical verdict; every other realpath error (EACCES, ELOOP, …) fails closed, with a dedicated unit test | task .1 Approach + Acceptance |
| N3 | **Incorporated** — direct security-test assertion that no CSP directive contains `unsafe-eval`, explicitly not relying on the task-.6 JS-action fixture alone; `frame-ancestors 'none'`, `object-src 'none'`, `X-Frame-Options: DENY` re-asserted incl. on a doc-asset response | task .1 Approach + Acceptance |
| N4 | **Incorporated** — `preventDefault()` only when the viewer actually handles the key; out-of-scope cases (focus in page input, disabled/zero-page controls, page boundaries with no action) must leave the event unprevented so native scrolling survives. Both halves asserted (`defaultPrevented` true + state change / false + no state change) | task .4 Approach + Acceptance |
| N5 | **Incorporated** — the `basename(doc.relPath)` derivation must be validated, not assumed: exercised against nested `relPath`, `recordSourcePath`-backed and container-backed documents, plus a same-basename sibling; if basename cannot uniquely resolve, use full `relPath`/recorded source path and document the choice. Tests must prove the derived URL resolves the actual indexed PDF and cannot select the sibling | task .5 Approach + Acceptance |
| N6 | **Incorporated** — package smoke launches the **installed global binary** (not repo source) and asserts each response body is byte-identical (or content-hash equal) to the corresponding file inside the installed `pdfjs-dist`, not merely status and size; HEAD checked too | task .6 Approach + Acceptance |
| N7 | **Incorporated** — the `frontend-design:frontend-design` availability gate is stated in the spec execution notes and restated as a pre-start gate on task .4 (block via `flowctl block` and escalate if unavailable; server-side .1 and lib/fixtures .2 may still proceed). The plugin was invoked during this repair pass; the pinned Scholarly Dusk direction was preserved unchanged | spec Execution notes; task .4 Approach + Acceptance |

## Dependency DAG and execution order

```
.2  (baseline step 0 → pin pdfjs-dist → lib/pdf.ts facade + __gnoPdfMetrics → fixtures)
 └─> .1  (doc-asset Range + realpath hardening → /vendor/pdfjs/ routes → CSP worker-src)
      └─> .3  (use-pdf-document / use-pdf-pages / PdfPageView / text-layer CSS)   [depends_on: .2, .1]
           └─> .4  (PdfViewer shell + instrument rail + designed states + a11y)
                └─> .5  (DocView integration, Pages/Text toggle, fallback notice) [depends_on: .1, .4]
                     └─> .6  (browser smoke, P-1…P-6 evidence, package smoke)
                          └─> .7  (docs, CHANGELOG, gno.sh handoff brief, final gate)
```

Linear order: `.2 → .1 → .3 → .4 → .5 → .6 → .7`. JSON `depends_on` edges — `.2: []`,
`.1: [.2]`, `.3: [.2, .1]`, `.4: [.3]`, `.5: [.1, .4]`, `.6: [.5]`, `.7: [.6]` — are
acyclic and consistent with the MD "Execution order" section. All seven tasks remain
`status: todo`.

## Validation

| Command | Exit | Output |
| --- | --- | --- |
| `./.flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer --json` | 0 | `{"success": true, "spec": "fn-112-native-pdfjs-document-renderer", "valid": true, "errors": [], "warnings": [], "task_count": 7}` |
| `git diff --check` | 0 | no output (no whitespace errors) |
| `git rev-parse HEAD` | 0 | `bb994b580356a41a31093fea85b06993c1a18e4c` (unchanged) |
| `git status --porcelain .flow/` | 0 | only untracked/modified planning artifacts under `.flow/`; no product files, no commits |

## Changed artifacts

| File | Change |
| --- | --- |
| `.flow/specs/fn-112-native-pdfjs-document-renderer.md` | R9 and R17 coverage rows corrected; R16 records the in-repo surfaces as the complete documentation deliverable and the hosted-site work as a non-dependency; R17 points at the task-.2 baseline record; Boundaries state the in-repo brief is a completion dependency while gno.sh apply/QA/deploy is not, and forbid any claim that hosted docs were updated |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.2.md` | `satisfies` gains R17; acceptance now covers the step-0 baseline with exact commands, the complete facade export surface + single-import assertion, the module-level `__gnoPdfMetrics` channel with React-independent persistence, and the standard-font / cjk-cmap / zero-page fixtures with size bound |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.3.md` | P1 import contradiction removed (`TextLayer` via facade); precise StrictMode invariant (a)–(d) replacing "no duplicate load"; out-of-order URL-change and retry race tests; instrumentation moved to the facade-owned `globalThis` channel with unmount-survival test; cancellation via `isRenderingCancelled`; acceptance rewritten |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.4.md` | `satisfies` gains R9; `onFallback(reason)` replaces `onShowExtractedText` with the both-directions rule; frontend-design pre-start gate; N4 preventDefault-only-when-handled with both assertions; stable per-state test hooks for task .6; acceptance rewritten |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.5.md` | DocView-owned `pdfFallbackReason` flow with four reason-specific notices, clearing rule, and the no-extracted-text actionable case; N5 asset-URL derivation validation incl. same-basename sibling; test list and acceptance rewritten |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.6.md` | Clean vs interception run modes separated; behavioral cMap/standard-font offline proof; all seven R8 states driven deterministically incl. three bootstrap sub-cases; alignment evidence at 100%/fit-width/200%; numeric P-3, 20-sample p95 P-4, P-5 cap, P-6 destroy+silence with raw samples in the artifact; overview card + three rails asserted across both themes and both widths; N6 installed-binary + body-verification package smoke; acceptance rewritten |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.7.md` | Handoff brief added to Files; WEB-UI note for `__gnoPdfMetrics`; baseline reference corrected to task .2; P8 section replacing the vague follow-up note with the explicit do-not-touch-gno.sh rule, the in-repo brief requirement, and the external post-merge handoff / non-dependency statement; acceptance rewritten with exact gate commands |
| `.flow/reviews/fn-112-opus-plan-revision.md` | This receipt (new) |
| `.flow/reviews/fn-112-opus-plan-revision.json` | Structured receipt (new) |

Task JSONs `.1`–`.7` were re-read and required no edits: titles, `spec_path`, `status: todo`,
and `depends_on` already matched their MD counterparts and the repaired execution order.
`.flow/specs/fn-112-native-pdfjs-document-renderer.json` was left at
`plan_review_status: needs_work`, `plan_reviewed_at: 2026-07-31T14:23:18.915136Z`,
`status: open` — deliberately unstamped.

## Boundaries observed

No product code, dependency install, test run, commit, push, PR, publication, or index
operation was performed. `/home/claw/work/gno.sh` and GNO/Daniel-OS were not touched. No
approval or SHIP verdict was stamped; the plan gate remains `needs_work` and the spec is
not ready for implementation until an independent re-review passes.
