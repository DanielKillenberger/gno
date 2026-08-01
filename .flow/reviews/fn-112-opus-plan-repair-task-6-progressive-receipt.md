# fn-112 plan repair — task .6 progressive held-Range contract

**Date:** 2026-08-01
**Role:** canonical Opus 5, architectural plan-repair owner (no product code or tests written)
**Spec:** `fn-112-native-pdfjs-document-renderer` · branch `feat/native-pdf-renderer`

## The contradiction

Task .6 mandated that the interception route answer the **`Range`-less first
request** with exactly the first 64 KiB as a `206` whose `Content-Length` equals
the 64 KiB body and whose `Content-Range` carries the total. That mandate is
unsatisfiable against the pinned dependency, and it is also HTTP-incorrect on
its own terms (`206` answering a request that carried no `Range`).

Verified against `pdfjs-dist@5.7.284` in this repo's `node_modules` (read, not
assumed):

- `build/pdf.mjs:12930-12959` — `validateRangeRequestCapabilities` derives the
  document's total size **only** from `Content-Length`. `Content-Range` is never
  read. It also refuses ranges when `Content-Length <= 2 × rangeChunkSize`.
- v5.7 has no top-level `getDocument({url, length})` option; total length is
  reachable only through `PDFDataRangeTransport`.

So a 64 KiB `206` tells PDF.js the file is 65 536 bytes → ranges disabled → only
range 0 is ever requested, exactly as repeated canonical Grok experiments found
(`.flow/reviews/fn-112-grok-task-6-repair-round-{1,1b,2,2b,3,4-fresh}.*`).

## Chosen protocol — **C**: honest pass-through first response + range-mode loading policy

The supported v5.7 mechanism is `disableStream`. `build/pdf.mjs:13055-13057`:
when streaming is disabled and ranges are supported, `PDFFetchStreamReader`
cancels the full-body reader the instant headers arrive, and every subsequent
byte is fetched as a discrete `Range` request. `disableAutoFetch: true` stops
pdf.js eagerly pulling the remainder.

Concretely:

1. **Product (`src/serve/public/lib/pdf.ts`):** `getDocument` passes
   `disableStream: true`, `disableAutoFetch: true`. This is the correct behavior
   for a windowed viewer that only paints a bounded page window, not a test
   accommodation. The stale `pdf.ts:158-164` comment describing the fetch bridge
   is deleted. `GET /api/doc-asset` is **unchanged** — it already emits
   `Accept-Ranges: bytes`, true `Content-Length`, and byte-correct `206`/`416`
   (R11, task .1).
2. **Test (`scripts/pdf-viewer-smoke.ts`):** `page.route()` still touches only
   the generated large fixture's `/api/doc-asset` URL. A request with **no**
   `Range` header is `route.fetch()`ed against the real same-origin endpoint and
   fulfilled verbatim — genuine `200`, true `Content-Length`, nothing truncated
   or rewritten. Only **later `Range` requests** are synthesized, as byte-correct
   `206` slices from the fixture bytes read in the smoke process. Response
   *timing* is the sole synthetic element.
3. **Fixture gate:** the generated fixture must exceed `2 × rangeChunkSize`
   (> 128 KiB at the 64 KiB default), asserted in the smoke, failing loudly.
4. **`installPdfjsRangeLengthBridge` is deleted** (currently still live at
   `scripts/pdf-viewer-smoke.ts:994`, installed at `:1929`).

The oracle is **unchanged and not weakened**: same-instant `pdf-page-column`
present, ≥ 1 `data-rendered="true"`, ≥ 1 `data-rendered="false"`, zero
`pdf-state-*`, ≥ 1 later `Range` still held, pending node non-zero dims with
`|w/h − 17/22| ≤ 0.01`; no fixed sleeps; all held routes released in `finally`.

## Rejected alternatives

| Option | Verdict | Reason |
| --- | --- | --- |
| **A** — dedicated local byte-correct Range server/proxy on its own origin, `page.route` redirecting the fixture URL to it | Rejected | Production CSP is `connect-src 'self'` (`src/serve/server.ts:159-161`). A second origin is blocked unless the run relaxes CSP, which breaks the "security envelope unchanged" acceptance item. It also needs CORS + `Access-Control-Expose-Headers` for `Accept-Ranges`, and buys nothing: the real endpoint already *is* a byte-correct Range server, reachable same-origin via `route.fetch()`. Protocol C is A's goal with the extra origin removed. |
| **B** — test-owned `PDFDataRangeTransport` via a narrow diagnostic hook | Rejected | Bypasses the HTTP layer entirely, so it proves nothing about real `Range` behavior against the production endpoint, and requires a production injection point that exists only for tests. |
| Top-level `getDocument({url, length})` | Rejected | Does not exist in v5.7. |
| Falsified `Content-Length` | Rejected | Violates the byte-correct-HTTP acceptance item. |
| Page-side fetch/response bridge (`installPdfjsRangeLengthBridge`) | Rejected | Same falsification, moved into the page; explicitly out of contract. |
| Non-linearized fixture / stream-flag variants | Rejected | Empirically failed across rounds 1–4. |
| Relying on real localhost timing with streaming defaults | Rejected | A race against loopback throughput; not deterministic evidence. |

## Changed artifacts

| File | Change |
| --- | --- |
| `.flow/tasks/fn-112-native-pdfjs-document-renderer.6.md` | Progressive bullets rewritten (range-mode loading policy, honest pass-through first request, later-ranges-only synthesis, > 128 KiB fixture gate); both acceptance blocks updated; `Files` extended with `src/serve/public/lib/pdf.ts` + its unit test; investigation target added for the pinned pdf.mjs line ranges; `Commands` block added; supersession note recorded in Key context. |
| `.flow/specs/fn-112-native-pdfjs-document-renderer.md` | "Deterministic progressive evidence" block names the pass-through first response; new decision bullet documenting the range-mode loading policy with the verified pdf.mjs citations and the explicit supersession list. |
| `.flow/specs/fn-112-native-pdfjs-document-renderer.json` | `plan_review_status` `ship` → `needs_work`; `ready` `true` → `false`; `plan_reviewed_at` `2026-07-31T19:06:52.496019Z` → `null` (superseded value recorded here); `updated_at` bumped. `plan_review_rounds` left at 1. |

**Untouched, deliberately:** all task `.json` states (`.1`–`.3` `done`;
`.4`–`.7` as they stand), every accepted task receipt under `.flow/reviews/`,
`completion_review_status` (`unknown`), task `.7`, and all product code and
tests.

## Sol plan re-review round 1 — dispositions

Receipt: `.flow/reviews/fn-112-sol-plan-rereview-task6-progressive-round1.json`
(reviewer Sol, canonical `gpt-5.6-sol`, `reviewed_at_utc` `2026-07-31T23:01:44Z`).
**Verdict: NEEDS_WORK**, with the progressive protocol itself explicitly
accepted — Sol independently confirmed the pinned-dep mechanism
(`validateRangeRequestCapabilities` honest total from `Content-Length`;
`PDFFetchStreamReader` header-time cancel at `pdf.mjs:13055-13057`), confirmed
that `route.fetch()` + `route.fulfill({response})` buffering does not suppress
the later `Range` requests, and confirmed no binding synthetic-64-KiB mandate
remains. Two mechanical Flow-consistency repairs were required.

### PR6-01 — task lifecycle metadata (blocking) → **fixed**

Only lifecycle metadata was written; no task content, implementation, test, or
receipt was touched, and no verdict was invented.

| Task | Before | After | Backing receipt (unchanged) |
| --- | --- | --- | --- |
| `.4` | `todo` | `done` | `.flow/reviews/fn-112-sol-impl-rereview-task-4-round3.json` — **SHIP**, no blocking findings; repair `…-grok-implementation-task-4-repair-round2.json` |
| `.5` | `todo` | `done` | `.flow/reviews/fn-112-sol-impl-rereview-task-5.json` — **SHIP**, no blocking findings; repair `…-grok-implementation-task-5-repair.json` |
| `.6` | `todo` | `in_progress` | none — unaccepted by design |

`.4`/`.5` gained `last_summary` + `last_evidence` in the same shape the already-
`done` neighbours use (`.1.json`, `.3.json`), each carrying the existing receipt
path, the real Sol verdict, and a `lifecycle_note` recording that only metadata
was reconciled. `.6` gained a truthful `claim_note`; **`claimed_at` is left
`null`** because the task was never claimed through `flowctl start` and no claim
timestamp exists to record — inferring one would be fabrication. `updated_at` on
all three is `2026-08-01T01:05:00Z`, the time of *this metadata correction*, not
a back-dated acceptance time.

**Not touched:** `.1`, `.2`, `.3` (`done`) and `.7` (`todo`) states; all
`depends_on`, `created_at`, titles, and priorities.

### PR6-02 — stale multi-range wording in task `.1` (blocking) → **fixed**

Two statements in `.flow/tasks/fn-112-native-pdfjs-document-renderer.1.md`
mandated "multi-range → full-body 200", contradicting both the spec's API
contract table (line 342: multi-range → `416`) and the accepted implementation
(`src/serve/routes/api.ts:2163` doc comment, `:2112-2113` comma detection →
`malformed` → `:2265-2267` `416` + `Content-Range: bytes */total`).

- Approach bullet (line 15): `multi-range → treat as full-body 200` →
  `multi-range → strict 416 + Content-Range: bytes */total`.
- Acceptance item (line 36): `multi-range → documented full-body behavior` →
  `multi-range → strict 416 with Content-Range: bytes */total`.
- A dated reconciliation note added under Key context recording the correction,
  its evidence, and that task `.1` keeps `done` status with its existing
  receipts (`…-grok-task-1-repair-round3.json`; Sol round-4 re-review
  `…-sol-impl-rereview-task-1-round4.json` — **SHIP**).

Single-range (`bytes=a-b`, `bytes=a-`, `bytes=-n`), full-GET, and HEAD contracts
are unchanged. No implementation or test was reopened.

### Non-blocking observation raised by this repair (for the owner, not fixed here)

`src/serve/routes/api.ts:2111` still carries a stale *code comment* —
`// Multi-range: not supported — signal so caller can serve full body` — while
the code beneath it correctly yields `416`. The comment is wrong, the behavior
is right. Product code is out of scope for a plan repair; fold the one-line
comment fix into task `.6`'s tidy-up pass.

## Validation

- `git diff --check` → **PASS** (exit 0; no output). Note: the edited Flow artifacts are untracked, so this check covers the tracked tree only.
- `./.flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer --json` → **PASS**, run immediately after the Opus wrapper session by the workflow owner:

```json
{
  "success": true,
  "spec": "fn-112-native-pdfjs-document-renderer",
  "valid": true,
  "errors": [],
  "warnings": [],
  "task_count": 7
}
```

The independent Sol plan re-review gate is now open; this receipt does not mark the repaired plan SHIP.

### Validation — Sol round-1 repair pass (2026-08-01)

- `git diff --check` → **PASS** (exit 0, no output). The edited Flow artifacts are untracked, so this covers the tracked tree only.
- `./.flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer --json` → **PASS**, run by the workflow owner immediately after the Opus wrapper session: `success=true`, `valid=true`, `errors=[]`, `warnings=[]`, `task_count=7`.
- JSON state readback: `.1`–`.5` = `done`; `.6` = `in_progress`; `.7` = `todo`.

Sol round 2 is open; this receipt still does not mark the repaired plan SHIP.

## Required gate

The plan is deliberately **not** marked SHIP by this repair. It sits at
`needs_work` / `ready=false` pending an **independent Sol plan re-review** of:

1. the range-mode loading policy as a *product* decision (it changes how every
   PDF > 128 KiB is fetched, not just the test path);
2. the honest pass-through first response and the narrowed synthesis surface;
3. that the progressive oracle survived intact.

Only Sol may restore `plan_review_status: ship` / `ready: true`. Nothing here is
committed, pushed, merged, or activated.
