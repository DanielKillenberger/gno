# fn-112 plan-repair addendum — P9, P10, P11 only

- **Owner**: Opus 5 (expected canonical model `claude-opus-5`, effort `medium`)
- **Stage**: plan-repair addendum (planning only)
- **Flow ID**: `fn-112-native-pdfjs-document-renderer` (unchanged)
- **Status**: `completed` — **gate state**: `needs_work`
- **Base / head SHA**: `bb994b580356a41a31093fea85b06993c1a18e4c` (unchanged)
- **Branch**: `feat/native-pdf-renderer`
- **Scope**: exactly P9, P10, P11 from `.flow/reviews/fn-112-sol-plan-rereview.json`

## P9 — executable performance protocol

The old P-4 was internally impossible: every latency sample waited for the previous
render to settle, yet cancel-before-restart was asserted on every commit, so a correct
renderer could fail. P-4 is now **two independent checks that are never conflated**:

- **P-4a — sequential re-render latency (no cancellation expected).** 20 alternating
  100%/200% commits on the small fixture at fit-width; each commit is issued **only
  after** the previous visible render settled; sample = commit → last visible
  `renderSettle(completed)`; ascending sort; p95 = the 19th of 20; threshold stays
  **≤ 500 ms**. No `renderCancel` is required or expected, and its absence is
  explicitly not a failure. The only ordering assertion is that every `renderStart`
  reaches a terminal `renderSettle`.
- **P-4b — cancellation ordering under deliberate overlap.** Made executable rather
  than timing-racy by driving it off `__gnoPdfMetrics` instead of sleeps: commit a
  zoom/fit change; **prove it is in flight** by polling until that generation has a
  `renderStart` with no terminal settle (escalate the render cost — larger fixture,
  higher zoom, larger viewport — if it always settles too fast; **fail loudly** if an
  in-flight state can never be observed; never degrade to a sleep or skip); then, while
  in flight, commit the replacement change and assert on the recorded event stream that
  the superseded generation's `renderCancel` precedes its `renderSettle(cancelled)` and
  both precede the replacement generation's first `renderStart`, that the superseded
  generation **never** later records `renderSettle(completed)`, and that no stale output
  is painted. Run at least twice (zoom→zoom, zoom→fit-mode); store the full ordered
  event stream.

Task .3 additionally forbids synthesizing a `renderCancel` for an already-terminal task.

## P10 — observed PDF.js auxiliary-asset semantics

Every claim that cMap or standard-font 404s necessarily reject the document load or
enter DocView's bootstrap fallback is removed.

- **Worker startup/bootstrap failure** (404-fulfilled worker route — the load genuinely
  rejects) remains the **sole** deterministic bootstrap reason/notice/fallback UI case,
  and the only bootstrap sub-case in task .6's R8 state list. R8 states the exclusion
  explicitly; `"bootstrap"` is pinned at the classifier definition sites (spec facade
  row, task .2) and at the consumer (task .4) as a document-load rejection only.
- **Auxiliary cMap/standard-font failures** get their own failure-mode row and their own
  executable checks in task .6 (404-fulfil the cMap request while opening
  `cjk-cmap.pdf`; 404-fulfil the standard-font request while opening
  `standard-font.pdf`). Each asserts: the expected same-origin request was attempted and
  fulfilled 404; the outcome PDF.js **actually** produces is captured first and then
  asserted against that capture — console warning text (Playwright console listener,
  dumped verbatim) and/or degraded text-layer content plus a canvas pixel sample diffed
  against the clean run, or a classified page-render error if one is genuinely produced;
  **zero non-`self` requests** (no external fallback); the security envelope is unchanged
  (CSP without `unsafe-eval`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`); the
  viewer stays actionable (toolbar, Pages/Text toggle, download) and never crashes; and
  the observation is deterministic — each case runs twice and must classify identically,
  with raw observations in the evidence artifact.
- **No** document-load fallback transition, `bootstrap` classification, or DocView notice
  is required or asserted for these two cases, and **no page-error propagation
  architecture is invented**: if the observed outcome turns out to be a genuine
  page-render error the current architecture cannot surface, task .6 reports it as a
  finding for the spec owner. R18 records the auxiliary cases separately from the R8 list.

## P11 — branch metadata

Spec JSON `branch_name` is now exactly **`feat/native-pdf-renderer`**. The spec's
execution notes record that implementation continues on that already-checked-out branch
(base `bb994b58`): no branch is created, switched to, or otherwise targeted, and the
Flow ID is unrelated to the branch name and unchanged. A grep across the spec and all
seven task MD+JSON files confirmed no other artifact carries branch metadata, so nothing
else needed reconciliation.

## Touched artifacts

- `.flow/specs/fn-112-native-pdfjs-document-renderer.md`
- `.flow/specs/fn-112-native-pdfjs-document-renderer.json`
- `.flow/tasks/fn-112-native-pdfjs-document-renderer.2.md`
- `.flow/tasks/fn-112-native-pdfjs-document-renderer.3.md`
- `.flow/tasks/fn-112-native-pdfjs-document-renderer.4.md`
- `.flow/tasks/fn-112-native-pdfjs-document-renderer.6.md`
- `.flow/reviews/fn-112-opus-plan-revision-p9-p11.md` (this file)
- `.flow/reviews/fn-112-opus-plan-revision-p9-p11.json`

Tasks .1, .5, .7 and every task JSON are untouched. The prior receipts
(`fn-112-opus-plan-revision.md` / `.json`) were **not** modified.

**P1–P8 and N1–N10 were not reopened or rewritten.** The only edits outside P9/P10/P11
are the minimal cross-references directly coupled to them: the meaning of `"bootstrap"`
in `classifyPdfError` / `PdfFallbackReason` (spec facade row, task .2, task .4) and the
P-4a/P-4b cancellation cross-reference (task .3, task .4). Approved requirements
(R1–R19) and the seven-task order and statuses are preserved.

## Validation (planning-safe only)

| Command | Result |
| --- | --- |
| `./.flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer --json` | exit 0 — `valid: true`, 0 errors, 0 warnings, `task_count: 7` |
| `git diff --check` | exit 0, no output |
| `git rev-parse HEAD` | `bb994b580356a41a31093fea85b06993c1a18e4c` (unchanged) |
| `git status --short` | only the pre-existing modified `.flow/.gitignore` and untracked `.flow/` planning artifacts (plus the pre-existing untracked `INVESTIGATION-REPORT.md`); no product, test, dependency, or lockfile change; no commits |
| JSON parse of every changed JSON + all seven task JSON status reads | all parsed; `branch_name=feat/native-pdf-renderer`, `plan_review_status=needs_work`, seven tasks all `todo` |

## Boundaries observed

Planning only. No product code or tests written, no dependencies installed, no product
tests run, no commit, push, PR, publication, or release. No other repository touched
(`~/work/gno.sh` untouched). Prior receipts unmodified. No approval or ship stamp.

## Next step

**Independent Sol full plan re-review** of the repaired artifacts. The gate remains
`needs_work`; canonical Grok 4.5 implementation must not begin until that review passes.
