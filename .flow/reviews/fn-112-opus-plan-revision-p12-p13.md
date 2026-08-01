# fn-112 plan-repair addendum — P12, P13 only

- **Owner**: Opus 5 (expected canonical model `claude-opus-5`, effort `medium`)
- **Stage**: plan-repair addendum (planning only)
- **Flow ID**: `fn-112-native-pdfjs-document-renderer` — **branch**: `feat/native-pdf-renderer`
- **Status**: `completed` — **gate state**: `needs_work`
- **Base / head SHA**: `bb994b580356a41a31093fea85b06993c1a18e4c` (unchanged)
- **Scope**: exactly P12 and P13 from `.flow/reviews/fn-112-sol-final-plan-review.json`

## P12 — metrics contract

The channel could not support its own assertions: it was "timestamped event names",
explicitly "counters only, no payloads", while P-3/P-4b need per-page, per-task,
per-generation correlation — and the stream was unbounded despite the bounded-memory
requirement. The spec now carries a dedicated **Metrics channel contract** section, and
every "counters only / no payloads" phrasing is explicitly superseded there and reworded
in tasks .2 and .3.

**Event schema** (one record per event): `seq` (per-channel monotonic, never reused — the
total order every ordering assertion uses), `t` (`performance.now()`, with one
channel-level `t0Epoch`), `docId` (opaque per-`getDocument` instance counter — two loads
of the same file differ), `pageNumber`, `taskId` (opaque per-`RenderTask` counter,
channel-unique), `genId` (monotonic per `docId`, bumped on every zoom/fit/scale commit; a
task's cancel and settle repeat its start's `genId`), `kind`, `outcome`
(`completed|cancelled|failed`, only on `renderSettle`), `scale`, and
`canvasWidth`/`canvasHeight` (post-DPR/area-cap backing-store dims). Identifiers are
opaque in-process counters, **never** derived from a URL, path, URI, filename, or title,
and no field carries document text — task .2 adds a privacy unit assertion using
distinctive fixture path and title strings.

**Invariants** (unit-tested in task .3): exactly one terminal `renderSettle` per
`renderStart` `taskId` — never zero, never two; `renderCancel` at most once per `taskId`,
after its start and before its settle, whose `outcome` is `cancelled`; `taskId`
channel-unique, with `(docId, pageNumber, genId)` correlating task to page and
generation; `genId` non-decreasing, and a replacement generation's first `renderStart`
has strictly greater `seq` than the superseded generation's `renderCancel` and
`renderSettle(cancelled)` — exactly the P-4b assertion.

**Retention / reset / snapshot / export**: a bounded ring buffer (~2 000 events by
default) that increments a visible `dropped` counter instead of growing, so truncation
can never be misread as "nothing happened"; `reset({capacity})` clears
records/`dropped`/sequence and may raise capacity for a QA run; `snapshot()` returns a
frozen structural clone plus `{capacity, dropped, seqHigh, t0Epoch}` without mutating or
truncating the live buffer; `export()` yields the JSON-serializable evidence form.

**QA protocol (task .6, every P-3/P-4/P-6 window)**: `reset({capacity})` with ample
headroom before the window; measure from `snapshot()`; **assert `dropped === 0` on every
snapshot used for an assertion** — non-zero invalidates the measurement and forces a
re-run, never a pass; correlate by `docId`/`pageNumber`/`taskId`/`genId` ordered by
`seq`; export each window verbatim into the artifact. P-3 counts starts scoped to the
document instance from a `dropped === 0` snapshot with exactly-one-terminal-settle; P-6
scopes `documentDestroy` and the 1 s silence window to the `docId`. P-3/P-4/P-6 remain
executable, and the records stay content-free.

## P13 — durable baseline

Task .2 step 0 still captures the baseline **before** any dependency or product edit —
that rule is unchanged — but now writes a **durable in-repository receipt**
`.flow/reviews/fn-112-baseline-receipt.json` (human-readable twin `.md`) in the same
step; `/tmp/fn112-baseline/` is explicitly scratch. The receipt is a Flow evidence
artifact only: under `.flow/reviews/`, not product code, in no `files` array, imported by
nothing, covered by no product test.

Per command it records the exact command string, exit status, duration, parsed pass/fail
counts, the **enumerated** pre-existing failure list, and the raw log's `sha256` + path.
Top level: `base_sha` `bb994b580356a41a31093fea85b06993c1a18e4c`, branch
`feat/native-pdf-renderer`, a clean-worktree flag, Bun and `tsc` versions,
platform/arch/uname, ISO start/finish timestamps, and environment notes.

**Regeneration**: if the raw logs vanish or hash-mismatch, regenerate deterministically —
`git worktree add --detach <tmpdir> bb994b580356a41a31093fea85b06993c1a18e4c`,
`bun install --frozen-lockfile` **inside that worktree only** (never mutating the working
tree's `node_modules`/lockfile), the same four commands, then `git worktree remove`. The
result is **appended** as a new `captures[]` entry with `regenerated: true` and its
reason; the original entry is never edited or deleted, and any failure-list divergence is
recorded rather than overwritten.

**R17 comparison rule**: the final gate diffs its failures against the named list in the
cited `captures[]` entry; a failure absent from that list is a new failure and blocks; the
completion evidence cites the receipt path and the exact `capture_id`; a missing or
unverifiable receipt means R17 is not yet satisfiable. Task .7's final gate and both
acceptance lists use that citation form, and the baseline citations in tasks
.1/.3/.4/.5/.6 now point at the receipt rather than the `/tmp` path.

Nothing was executed: no baseline run, no worktree, no install — this is the plan for it.

## Consistency audit

- **"counters only / no payloads"** — no contradiction remains; the only surviving
  occurrences are the deliberate reconciliation statements (the spec's superseding clause
  and task .2's explicit "not counters only").
- **Schema alignment** — spec contract, task .2 (channel owner), task .3 (hook emitters
  and unit acceptance) and task .6 (QA protocol) use one identical field set and one
  identical set of invariants.
- **Baseline citations** — no artifact treats `/tmp/fn112-baseline/` as authoritative; it
  appears only where named as scratch raw-log storage.

## Touched artifacts

Spec MD; tasks .1, .2, .3, .4, .5, .6, .7 MD; these two receipts. **No task JSON and no
spec JSON changed.** Prior receipts (`fn-112-opus-plan-revision*`,
`fn-112-opus-plan-revision-p9-p11*`) were not modified.

**P1–P11 and N1–N13 are frozen** — not reopened or rewritten. Sol's N11/N12/N13 confirm
those repairs stand. Edits outside P12/P13 are limited to the coupled baseline-citation
strings that P13 makes durable. R1–R19, the seven-task order, and all `todo` statuses are
preserved.

## Validation (planning-safe only)

| Command | Result |
| --- | --- |
| `./.flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer --json` | exit 0 — `valid: true`, 0 errors, 0 warnings, `task_count: 7` |
| `git diff --check` | exit 0, no output |
| `git rev-parse HEAD` | `bb994b580356a41a31093fea85b06993c1a18e4c` (unchanged) |
| `git status --short` | only pre-existing modified `.flow/.gitignore` and untracked `.flow/` planning artifacts (plus pre-existing `INVESTIGATION-REPORT.md`); no product, test, dependency, or lockfile change; no commits |
| JSON parse of changed JSON + seven task status reads | all parsed; `branch_name=feat/native-pdf-renderer`, `plan_review_status=needs_work`, seven tasks `todo` |
| Grep audit (`counters only` / `no payloads` / `/tmp/fn112-baseline`) | no contradictions remain |

## Boundaries observed

Planning only. No product code or tests written, no dependencies installed, no product or
baseline commands run, no worktree created, no commit, push, PR, publication, or release.
No other repository touched (`~/work/gno.sh` untouched). Prior receipts unmodified. No
approval or ship stamp.

## Next step

**Independent Sol full plan re-review.** The gate remains `needs_work`; canonical Grok 4.5
implementation must not begin until that review passes.
