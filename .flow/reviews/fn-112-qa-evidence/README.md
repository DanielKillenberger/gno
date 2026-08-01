# fn-112 — integrated live QA pass (`/flow-next:qa`)

Spec: `fn-112-native-pdfjs-document-renderer`
Stage: `pipeline.qa = on`, run at the all-tasks-done juncture, before make-pr.

**QA_VERDICT: SHIP** — 8/8 scenarios PASS, 0 findings (P0=0, P1=0, P2=0).

## How this was driven

Real running app, not source inspection. A `gno serve` instance was started on a
random loopback port against a **temp** `GNO_CONFIG_DIR` / `GNO_DATA_DIR` /
`GNO_CACHE_DIR` and a temp collection seeded with the repo's PDF fixtures plus a
markdown companion, then driven with Playwright/Chromium headless at 1380×880.

The user's own long-running `gno serve` on port 3000 and their real GNO index
were **not** touched, driven, or mutated.

- Driver rung: `playwright/chromium` (headless, 1380×880)
- Harness: `qa-drive.ts.txt` (archived here as `.txt` so it is durable evidence
  without entering the linted source tree)
- Raw run output: `qa-run.out.txt`
- Machine receipt: `qa-verdict.json`
- Console capture: `console.log`; request capture: `requests.json`

## Scenarios

| ID    | R-IDs           | Scenario                                                        | Result | Observed |
| :---- | :-------------- | :-------------------------------------------------------------- | :----- | :------- |
| QA-1  | R1, R2, R6      | PDF opens in Pages: rendered page + selectable text layer, no iframe/object/embed | PASS | 3 rendered pages, 218 text-layer chars, 0 embeds |
| QA-10 | R2, R3          | All viewer traffic same-origin; pdfjs assets from `/vendor/pdfjs` | PASS  | 0 foreign requests, 2 `/vendor/pdfjs/` requests |
| QA-3  | R4              | Page navigation advances the page                                | PASS   | page 1 → 2 |
| QA-5  | R5              | Keyboard `+` zooms, `0` resets to 100%                           | PASS   | reset observed; screenshot confirms 100% |
| QA-2  | R9              | Pages/Text toggle switches both ways                             | PASS   | Text: 0 canvases, 1 `<pre>`; back to Pages re-rendered |
| QA-8  | R9, R11         | Download original resolves over `/api/doc-asset`                 | PASS   | `HEAD 200`, `accept-ranges: bytes`, `application/pdf` |
| QA-6  | R8, R9          | Corrupt PDF shows a designed failure state with reason + download | PASS  | `pdf-state-corrupt` panel, "CANNOT RENDER" copy, 3 download actions |
| QA-9  | R19             | Non-PDF markdown document unaffected                             | PASS   | 0 PDF canvases, content rendered |

Screenshots: `QA-1-pages-rendered.png`, `QA-2a-text-view.png`,
`QA-2b-back-to-pages.png`, `QA-3-page-nav.png`,
`QA-5-keyboard-zoom-reset.png`, `QA-6-corrupt-designed-state.png`,
`QA-9-markdown-regression.png`.

`QA-1` and `QA-6` were additionally inspected directly rather than trusted from
the exit code: QA-1 shows the rendered fixture page with the toolbar reading
`1 / 5`, `100%`, fit-width/fit-page and the Text pill; QA-6 shows the designed
`CANNOT RENDER` panel with **Try again** and **Download original** and the
toolbar correctly disabled at `0 / 0`.

## One corrected scenario — recorded for honesty

The first run reported `QA-6 FAIL`. That was a **defect in the scenario, not in
the product**: it only accepted the DocView fallback notice or the
no-extracted-text sub-state. The implemented contract is branch-aware — the
DocView fallback notice engages only when extracted text is available, and
`corrupt.pdf` has none, so the correct designed state is the viewer's own
`pdf-state-corrupt` error panel (`PdfViewer.tsx:387-397`).

The assertion was corrected to be branch-aware **and stricter** than before: it
now requires a designed state **and** the named reason copy **and** a Download
original action. It was not weakened to pass.

## Console

Only the incidental-noise classes already characterized and accepted in task .6:
a CSP `base-uri 'none'` notice, transient dev-server 503s during SPA boot, a
pdf.js "Indexing all PDF objects" recovery warning on the corrupt fixture, and
the aborted fetch for that same corrupt fixture. No unexplained page errors.

## Scope note

This pass covers the in-repo Web UI surface. The hosted site `gno.sh` is **not**
covered — it is absent from this environment and out of the engagement's
authorized scope. Its QA checklist is specified in
`.flow/handoff/fn-112-gno-sh-docs-brief.md` as an external post-merge owner
handoff.
