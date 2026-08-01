# fn-112 plan-repair addendum — P15 only

- **Owner**: Opus 5 (expected canonical model `claude-opus-5`, effort `medium`)
- **Stage**: plan-repair addendum (planning only)
- **Flow ID**: `fn-112-native-pdfjs-document-renderer` — **branch**: `feat/native-pdf-renderer`
- **Status**: `completed` — **gate state**: `needs_work` (pending independent Sol re-review; this receipt confers no approval)
- **Base / head SHA**: `bb994b580356a41a31093fea85b06993c1a18e4c` (unchanged)
- **Scope**: exactly P15 from `.flow/reviews/fn-112-sol-plan-review-round5.json`. N16 and N17 are non-blocking and were not actioned.

## P15 — the planning-worktree assertion was impossible to satisfy on regeneration

The schema required **every** `captures[]` entry, including regenerated ones, to carry
`planning_worktree_state` asserted to contain no product-path changes. But task .7
explicitly permits regeneration *after* tasks .1–.6 have implemented the feature, when the
planning worktree necessarily holds product, test, dependency, lockfile, and documentation
changes. Canonical Grok would have had to either write a false receipt or violate the
regeneration contract.

**Resolution — `planning_worktree_state` is informational and never gating:**

- **Initial capture** (`regenerated: false`) — the no-product-path-changes assertion is
  retained and is true by construction: step 0 runs before `bun add` and before any product
  edit, so the only dirt is Flow planning state (this spec, the task files, the review
  receipts, `.flow/.gitignore`, `INVESTIGATION-REPORT.md`).
- **Regenerated captures** (`regenerated: true`) — that assertion **does not apply and must
  not be made**. The field records the planning worktree's *actual* state truthfully (a
  summary, or the `git status --porcelain` output), **including** the product, test,
  dependency, lockfile, and documentation changes expected once tasks .1–.6 have run. Such
  dirt is explicitly expected, is not a defect, and never invalidates a capture. Task .7
  additionally forbids cleaning, stashing, or reverting the working tree to satisfy it.
- **Baseline provenance rests solely on the isolated detached worktree** — its `head_sha`
  equal to the exact base SHA `bb994b580356a41a31093fea85b06993c1a18e4c`, its empty
  `git status --porcelain`, the `bun install --frozen-lockfile` setup leaving `bun.lock`
  unchanged, the exact canonical command results, the raw-log `sha256` hashes, and the
  capture's unique `capture_id`. The planning worktree's cleanliness is not part of that
  chain, at any capture. Regeneration is stated to be valid at any point in the lifecycle,
  including after implementation.

**Preserved unchanged:** the single versioned append-only `captures[]` schema, the initial
capture as `captures[0]`, unique `capture_id`s, the exact five canonical commands
(`bun run lint:check`, `bunx tsc --noEmit`, `bun test`, `bun run test:web`,
`bun run docs:verify`), and the absolute-pass gates outside that list.

## Alignment

| Artifact | Change |
| --- | --- |
| `spec …renderer.md` (R17) | New "informational and never gates a capture" clause splitting initial vs regenerated; provenance restated as isolated-worktree-only |
| `task .2` | Schema field split by capture kind; both acceptance lists reworded; regeneration bullet states lifecycle-any-time validity and the provenance chain |
| `task .7` | Regeneration instructions state that post-implementation dirt is expected, forbid the assertion on regenerated captures, and forbid cleaning/stashing/reverting to satisfy it |
| `p13a-p14` receipt (`.md` + `.json`) | **Labelled addendum appended**, not rewritten — names P15, states what was wrong, points here; all original transaction facts preserved verbatim |

## Consistency audit

- The no-product-path-changes assertion appears **only** as initial-capture-only, in spec
  R17, task .2's schema, both of task .2's acceptance lists, and task .7. No artifact
  requires it on a regenerated capture.
- Spec R17, task .2, and task .7 all state the field is informational and never gates a
  capture or baseline validity.
- All four passages name the same provenance chain (isolated worktree `head_sha` at the
  exact base SHA, empty status there, frozen-lockfile setup with unchanged `bun.lock`,
  exact canonical command results, raw-log `sha256`, `capture_id`).

## Not actioned (non-blocking)

- **N16** — the vendor-route extension allowlist is not enumerated (`.bcmap` for cMaps; the
  extensions pinned `pdfjs-dist` actually ships for standard fonts). Left for a future pass
  or implementation-time judgement rather than widening this surgical transaction.
- **N17** — confirms P14 is resolved; no action required.

## Validation (planning-safe only)

| Command | Result |
| --- | --- |
| `./.flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer --json` | exit 0 — `valid: true`, 0 errors, 0 warnings, `task_count: 7` |
| `git diff --check` | exit 0, no output |
| `git rev-parse HEAD` | `bb994b580356a41a31093fea85b06993c1a18e4c` (unchanged) |
| `git status --short` | only pre-existing modified `.flow/.gitignore` and untracked `.flow/` planning artifacts (plus pre-existing `INVESTIGATION-REPORT.md`); no product, test, dependency, or lockfile change; no commits |
| JSON parse of changed JSON + seven task status reads | all parsed; `branch_name=feat/native-pdf-renderer`, `plan_review_status=needs_work`, seven tasks `todo` |
| Grep audit (`planning_worktree_state`, assertion scope, provenance wording) | consistent across spec, task .2, task .7 |

## Boundaries observed

Planning only. No product code or tests written, no dependencies installed, no product or
baseline commands run, no worktree created, no commit, push, PR, publication, or release.
No other repository touched (`~/work/gno.sh` untouched). Prior receipts were **appended to
with a labelled correction, never rewritten**. No approval or ship stamp.

## Next step

**Independent Sol full plan re-review.** The gate remains `needs_work`; canonical Grok 4.5
implementation must not begin until that review passes.
