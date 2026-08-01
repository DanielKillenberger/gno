# fn-112 task .6 — durable gate artifacts

Raw command output for the task-.6 acceptance gates, kept in-repo so a reviewer
can inspect the evidence directly rather than trusting owner summaries.

Base/HEAD `bb994b580356a41a31093fea85b06993c1a18e4c`, branch
`feat/native-pdf-renderer`. Owner: Claude Opus 5, effort medium, session
`5ff94573-c8ee-4297-96d9-f8d27360de84`. No commit, push, PR, or merge.

## Contents

| File | Gate | Verdict marker |
| --- | --- | --- |
| `negative-control.sh` | guard-only negative-control harness (re-runnable) | — |
| `negative-control.log` | guard-only negative control, complete raw output | `OVERALL=PASS` |
| `gate-package.log` | `bun run test:package` | `PKG_EXIT=0` |
| `gate-e2e.log` | `bun run test:e2e:pdf` | `E2E_EXIT=0` |
| `gate-test-web.log` | `bun run test:web` | `WEB_EXIT=0` |
| `gate-full-bun-test.log` | `bun test` (full suite) | `FULL_EXIT=0` |
| `gate-use-pdf-pages.log` | `bun test …use-pdf-pages.dom.test.tsx` | `14 pass, 0 fail` |
| `gate-lib-pdf.log` | `bun test test/serve/public/lib/pdf.test.ts` | `23 pass, 0 fail` |
| `gate-components-pdf.log` | `bun test test/serve/public/components/pdf` | `44 pass, 0 fail` |
| `gate-scripts.log` | `bun test test/scripts/` (covers the sentinel module) | `33 pass, 0 fail` |
| `gate-typecheck.log` | `bun run typecheck` | exit 0 |
| `gate-lint.log` | `bun run lint:check` | `0 warnings and 0 errors` |

Browser evidence (screenshots, metrics, request/console logs, `evidence.json`,
`p4b-ladder.json`, `visual-theme-proof.json`, …) lives in
`.flow/reviews/fn-112-task-6-evidence/`.

## Privacy

Two deliberate, mechanical transformations are applied to these artifacts. They
remove non-evidentiary detail only; no verdict, count, measurement, or command
output was altered.

1. **Real-user sentinel output is narrowed at the source.** The package smoke
   still captures and compares *complete* before/after snapshots including
   per-file SHA-256 — that full comparison is what decides pass/fail. What is
   written durably is only: per-root kind, existence, before/after file count
   and byte total, and the equality result; plus, for the data root, product
   generated index filenames and sizes. The **config root is credential-bearing,
   so none of its filenames, sizes, modes, mtimes or hashes are emitted at all.**

   This corrects a real privacy regression (Sol SOL6-R5-IMPL-02): an earlier
   revision of this directory serialized a credential-bearing config file
   together with its absolute path, size, mode, mtime and SHA-256. That hash is
   a persistent verifier derived from the secret and has no place in a review
   artifact — the earlier "secret hygiene" claim here was wrong. The log was
   regenerated and the verifier purged repo-wide (it had also reached several
   owner/reviewer `.events.jsonl` transcripts, which now carry
   `<redacted-credential-hash-SOL6-R5-IMPL-02>` and still parse).

   Round 6 completed the cleanup (Sol SOL6-R6-IMPL-02): the **concrete filename**
   of that credential-bearing config file also appeared in this INDEX, in both
   transaction receipts, and in a source comment. It is now referred to only by
   the generic phrase everywhere. A repository-wide check — run with runtime
   constructed patterns so the check itself cannot reintroduce either value into
   a transcript — reports **0 occurrences** of the filename and **0** of the
   prior verifier. Nothing was ever committed, so there is no git-history
   exposure.

2. **Absolute home paths are replaced by `<home>`** across these logs. Ordinary
   test-runner output embeds developer workspace paths; they carry no secret but
   need not ship in a review artifact.

## What the negative control proves

`negative-control.log` records, in one uninterrupted run: mutation-site
uniqueness (exactly 1, asserted before mutating); the exact unified diff showing
the **only** change is removal of `canvasRef.current.get(pageNumber) === canvas &&`
from `identityStillValid`; guard count 1 → 0 → 1 with matching sha256
transitions; `NEGATIVE_CONTROL_EXIT=1` — a **normal test failure**, not a
signal/OOM/timeout — on `expect(staleCalls.map((c) => c.taskId)).toEqual([])`
with received `["r1"]`; restoration proven by `cmp` and hash equality; and the
restored positive rerun at `POSITIVE_RERUN_EXIT=0`.

Fail-safe restoration is built into the harness: a `trap` on `EXIT INT TERM HUP`
doing an atomic temp-write + `mv`, a detached `setsid` watchdog that restores
even under SIGKILL/OOM, and a 3 GiB-bounded `systemd-run` scope so a runaway
dies bounded rather than masquerading as evidence.

## What the package artifact proves

Installed-binary launch (binary path, package root, resolved installed
`pdfjs-dist`, `pid`/`port` with an explicit "NOT repo bun source" marker, and the
health check); then for the worker, one cMap and one standard font: installed
file bytes + sha256 versus GET status/bytes/sha256 with an explicit
`byte-equality: MATCH`, `HEAD status=200 bodyBytes=0`, and per-header `GET=… HEAD=…
MATCH` for `content-type`, `content-length`, `cache-control`. These are
ephemeral `/tmp` install paths and package-internal hashes — no user data.

The isolation proof then appears in the privacy-safe form described above,
ending in `Real GNO sentinel passed: 6 files / 155612828 bytes …`.

## Visual matrix (`visual-theme-proof.json`)

Two defects were found and fixed here:

- **Theme never applied (Sol SOL6-R5-IMPL-01).** `data-theme` was set *before*
  `openPdf`, which navigates and discards it, so all eight captures were the dark
  state and every "light" PNG was byte-identical to its dark counterpart. The
  theme is now applied *after* navigation and awaited until the computed custom
  properties settle. Recorded: dark `--background 0 0% 2%` /
  `rgb(5, 5, 5)` versus light `40 33% 98%` / `rgb(252, 250, 248)`.
- **`-overview` captures did not depict their subject** (found while verifying
  the above): they were a second full-page shot of the same viewport, byte
  identical to `-rail` wherever nothing scrolled. The subject is now scrolled
  into view, asserted on-screen, and captured **clipped to its own box** — the
  mobile overview card below `lg`, the properties rail at `lg` (where the card is
  `lg:hidden` and legitimately absent).

- **Rail captures shipped blank PDF canvases in light theme (Sol SOL6-R6-IMPL-01).**
  The non-blank wait ran *before* the theme was applied, so a theme-induced
  relayout/rerender could blank the canvas without anything noticing. After each
  theme settles, the harness now re-establishes the render with a bounded
  `waitForNonBlankCanvas` and asserts the fixture's own subject is present — at
  least one `data-rendered="true"` canvas **and** the fixture's known glyph run
  in the text layer — immediately before the rail capture, for every theme and
  width. A blank rerender now fails the run.

Assertions now enforce all of it: the theme attribute must survive navigation;
computed dark and light values must differ at each width; every paired dark/light
screenshot must differ by sha256; the clip subject must be present and on-screen;
and each rail capture's fixture page/text must be rendered post-theme. All **8**
screenshot hashes are distinct, and all eight PNGs were inspected directly —
every rail shows the rendered fixture page in its correct palette.
