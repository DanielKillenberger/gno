# fn-112 plan-repair addendum — P13A, P14 only

- **Owner**: Opus 5 (expected canonical model `claude-opus-5`, effort `medium`)
- **Stage**: plan-repair addendum (planning only)
- **Flow ID**: `fn-112-native-pdfjs-document-renderer` — **branch**: `feat/native-pdf-renderer`
- **Status**: `completed` — **gate state**: `needs_work`
- **Base / head SHA**: `bb994b580356a41a31093fea85b06993c1a18e4c` (unchanged)
- **Scope**: exactly P13A and P14 from `.flow/reviews/fn-112-sol-plan-review-round4.json`

## P13A — one versioned receipt schema, captured in an isolated worktree

The receipt had two shapes (a top-level `commands` array initially, named `captures[]`
entries for regeneration and citation), no rule making the initial capture `captures[0]`,
and it demanded `git_status_clean === true` in a planning worktree that is *necessarily*
dirty with the very artifacts under review — so the required initial receipt could not be
produced truthfully.

**One schema, from the first capture onward.** Immutable top level, written once:
`schema`, `schema_version: 1`, `spec_id`, `base_sha`
`bb994b580356a41a31093fea85b06993c1a18e4c`, `canonical_commands`, `captures: []`. The
contradictory top-level `commands` array and the top-level clean-tree/environment/
timestamp block are removed, and the artifacts now say explicitly that no such top level
exists.

**`captures[]` is append-only and its first entry is the initial capture.** Every entry —
initial and regenerated alike — is a complete, self-contained object:

| Field | Content |
| --- | --- |
| `capture_id` | unique, stable, cited by every later comparison |
| `regenerated` | `false` initially, `true` for later captures |
| `reason` | `null` initially; otherwise why regeneration was needed |
| `base_sha` | the SHA the commands actually ran at; equals the top-level value |
| `worktree` | path, create command, verified `head_sha`, empty `git status --porcelain` |
| `setup` | the `bun install --frozen-lockfile` run inside that worktree, with lockfile-unchanged confirmation |
| `commands[]` | per canonical command: exact string, exit status, duration, counts, **enumerated** `failures[]`, raw-log path + `sha256` |
| `environment` | Bun and `tsc` versions, platform/arch/uname, env notes |
| `started_at` / `finished_at` | ISO-8601 |
| `planning_worktree_state` | evidence-only record of the planning worktree's dirt |

**The initial capture now runs in an isolated detached worktree**, identical in shape to
regeneration: `git worktree add --detach <tmpdir> bb994b58…` → verify `head_sha` and empty
status → `bun install --frozen-lockfile` **inside that worktree only** (recorded as
`setup`) → the canonical commands → `git worktree remove`. Cleanliness is asserted *there*
and never in the planning worktree, whose dirt is recorded separately as
`planning_worktree_state`, asserted to contain no product-path changes, and is **never**
required clean and never gates the capture. Capture-before-product-change ordering,
append-only regeneration, and final citation by `capture_id` are all preserved.

## P14 — identical baseline and final command sets

Task .2 captured `bun test test/serve/` but neither full `bun test` nor
`bun run docs:verify`, while task .7 ran both and treated any failure absent from the
baseline list as new — so a pre-existing failure outside `test/serve/` or in docs
verification would have been misclassified as new and blocked the gate.

**Canonical baseline-compared commands (CBC)** — one list, identical strings, order, and
parsing, shared verbatim by spec R17, task .2's receipt (`canonical_commands`), and task
.7's final gate:

1. `bun run lint:check`
2. `bunx tsc --noEmit`
3. `bun test`  *(full suite — replaces the former `test/serve/` subset)*
4. `bun run test:web`
5. `bun run docs:verify`

Task .7 now runs those five verbatim and diffs **each command's** failures against **that
same command's** enumerated `failures[]` in the cited capture — no subset, superset, or
reformulation. **Everything outside the CBC is an absolute-pass gate**, never
baseline-compared: the new tests this spec adds, `bun run test:e2e:pdf`,
`bun run test:package`, and the P-1…P-6 budgets. Tasks .1 and .3–.6 keep focused subsets
for fast feedback, with the stated rule that a focused failure is checked against the
enumerated failures of the CBC command containing it (`bun test` for test files,
`bun run test:web` for the web DOM suite) and that task .7's verbatim CBC run is the
authoritative comparison. The spec's compatibility bullet was aligned to the same list.

## Consistency audit

- The identical five-command list appears in spec R17, task .2 (step 0 + acceptance), and
  task .7 (final gate + acceptance). No artifact still names `bun test test/serve/` as a
  baseline-captured command.
- Only one receipt schema is described anywhere; the surviving mentions of a top-level
  `commands` array and `git_status_clean` are the explicit negations.
- No artifact requires the planning worktree to be clean; the spec's execution-order
  paragraph was aligned to the isolated-worktree wording.
- `capture_id` citation and append-only regeneration are consistent across all three.

## Touched artifacts

Spec MD; task .2 MD; task .7 MD; these two receipts. **No spec JSON and no task JSON
changed.** Prior receipts were not modified.

**P1–P13 and N1–N15 are frozen** — not reopened. Sol's N14/N15 confirm P12 and P1–P11
stand. Edits are confined to the baseline/R17 surface P13A and P14 name. R1–R19, the
seven-task order, and all `todo` statuses are preserved.

## Validation (planning-safe only)

| Command | Result |
| --- | --- |
| `./.flow/bin/flowctl validate --spec fn-112-native-pdfjs-document-renderer --json` | exit 0 — `valid: true`, 0 errors, 0 warnings, `task_count: 7` |
| `git diff --check` | exit 0, no output |
| `git rev-parse HEAD` | `bb994b580356a41a31093fea85b06993c1a18e4c` (unchanged) |
| `git status --short` | only pre-existing modified `.flow/.gitignore` and untracked `.flow/` planning artifacts (plus pre-existing `INVESTIGATION-REPORT.md`); no product, test, dependency, or lockfile change; no commits |
| JSON parse of changed JSON + seven task status reads | all parsed; `branch_name=feat/native-pdf-renderer`, `plan_review_status=needs_work`, seven tasks `todo` |
| Grep audit (stale command sets, top-level clean-tree wording, canonical list presence) | consistent; no contradictions remain |

## Boundaries observed

Planning only. No product code or tests written, no dependencies installed, no product or
baseline commands run, no worktree created, no commit, push, PR, publication, or release.
No other repository touched (`~/work/gno.sh` untouched). Prior receipts unmodified. No
approval or ship stamp.

## Addendum — partially superseded by P15

Sol's round-5 review raised **P15** against this transaction's P13A wording: it required
**every** `captures[]` entry, including regenerated ones, to assert that
`planning_worktree_state` contains no product-path changes. That assertion holds only for
the *initial* capture — task .7 permits regeneration after tasks .1–.6 have implemented the
feature, when the planning worktree necessarily contains product, test, dependency,
lockfile, and documentation changes — so a regenerated capture could not have been recorded
truthfully.

The assertion is now initial-capture-only, and regenerated captures record the planning
worktree honestly as informational, non-gating evidence. See
`.flow/reviews/fn-112-opus-plan-revision-p15.md` / `.json`. Everything else recorded above
stands as executed and verified at the time; only that assertion's scope changed.

## Next step

**Independent Sol full plan re-review.** The gate remains `needs_work`; canonical Grok 4.5
implementation must not begin until that review passes.
