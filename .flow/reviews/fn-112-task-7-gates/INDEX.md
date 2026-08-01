# fn-112 task .7 — durable gate artifacts

Task: `fn-112-native-pdfjs-document-renderer.7` — Documentation, CHANGELOG, and
final quality gates.

Writer: canonical Claude Opus 5, medium effort (this session). Reviewer: Sol
(`gpt-5.6-sol`) via `/home/claw/.npm-global/bin/codex`. One editing writer.

## Baseline comparison (R17)

- Receipt: `.flow/reviews/fn-112-baseline-receipt.json`
- `capture_id` compared against: **`cap-001`** (`regenerated: false`)
- Base sha: `bb994b580356a41a31093fea85b06993c1a18e4c`
- Receipt integrity: **verified** — all five `raw_log_sha256` values in `cap-001`
  re-hash to the recorded value against the surviving raw logs under
  `/tmp/fn112-baseline/cap-001/`. Re-verified a second time after the `/tmp`
  cleanup described below. **No regeneration was required or performed.**
- **Tolerated pre-existing failures: NONE.** `cap-001` enumerates
  `failures: []` for every one of the five canonical commands, and every command
  exited 0. So the tolerance set is empty and the five commands must pass
  absolutely; any failure at all would be a new failure and would block.

## The five canonical baseline-compared commands (CBC)

Run verbatim, in the receipt's order, with the same parsing:

| # | Command                | Log                | Exit | Fail count | `cap-001` fail count | New failures |
| - | :--------------------- | :----------------- | :--- | :--------- | :------------------- | :----------- |
| 1 | `bun run lint:check`   | `01-lint.log`      | 0    | 0 errors, 0 warnings | 0        | none         |
| 2 | `bunx tsc --noEmit`    | `02-tsc.log`       | 0    | 0 (empty log)        | 0        | none         |
| 3 | `bun test`             | `03-test.log`      | 0    | 0            | 0                    | none         |
| 4 | `bun run test:web`     | `04-test-web.log`  | 0    | 0            | 0                    | none         |
| 5 | `bun run docs:verify`  | `05-docs.log`      | 0    | 0            | 0                    | none         |

Pass counts rose against the baseline because tasks .1–.6 added tests
(`bun test` 3463 → 3595 pass, 2 skip; `test:web` 186 → 295 pass;
`docs:verify` 15 pass / 2 skipped, unchanged). Only the **failure** sets are
baseline-compared, and both sides are empty.

## Absolute-pass gates (never baseline-compared)

| Gate                    | Log                 | Exit |
| :---------------------- | :------------------ | :--- |
| `bun run test:e2e:pdf`  | `06-e2e-pdf.log`    | 0 — `PDF viewer smoke PASSED`, P-1…P-6 within budget |
| `bun run test:package`  | `07-package.log`    | 0 — installed-binary pdfjs GET/HEAD byte equality + privacy-safe sentinel |
| `bun run build:css`     | `09-build-css.log`  | 0    |
| `flowctl validate --spec fn-112-native-pdfjs-document-renderer` | — | `Valid: True`, 7 tasks |
| `git diff --check`      | —                   | 0    |

### `test:package` — two environment-induced failures, diagnosed not masked

The log at `07-package.log` is the third and passing run. The first two failed
for environmental reasons that were each identified and legitimately cleared;
neither was suppressed, retried blindly, or worked around by weakening a gate.

1. **Real-GNO isolation sentinel tripped.** The smoke asserts the real user's
   GNO config/data state is unchanged across the run. It changed — because a
   long-running user-owned `gno serve` (PID 2666223, started Jul 31) watches an
   indexed collection covering this checkout, and its watcher fired a
   `gno update` (PID 2973054, 18:11) reindexing the documentation files edited
   in this task. The sentinel was correct; the mutation came from an external
   resident process, not from the package smoke or from this change. The
   user's running service was **not** killed. The run was repeated after that
   reindex completed and the sentinel then passed
   (`unchanged=true` for both roots, 6 files / 155612828 bytes).
2. **`/tmp` exhausted.** `npm install --global` failed with
   `TAR_ENTRY_ERROR ... Unknown system error -122` (EDQUOT/ENOSPC) on the 5.7G
   `/tmp` tmpfs. The cause was this task's own two forensic-recovery dumps from
   run 1 and run 2 (`/tmp/gno-package-smoke-LS7EzE` 2.5G,
   `/tmp/gno-package-smoke-7ISmBH` 2.0G) consuming 4.5G. Only those two
   directories — both created by this session, both confirmed by timestamp and
   as the only `gno-package-smoke-*` entries — were removed. Nothing else in
   `/tmp` was touched; `/tmp/fn112-baseline` was preserved and its hashes
   re-verified afterwards.

## `bun run build` — pre-existing failure, out of CBC scope

`bun run build` fails with
`Could not resolve: "youtube-transcript"` from
`node_modules/markitdown-ts/dist/index.mjs:434`. This is **pre-existing and
unrelated to fn-112**, proven rather than assumed: an isolated detached
worktree at base `bb994b580356a41a31093fea85b06993c1a18e4c`
(`git status --porcelain` empty there, `bun install --frozen-lockfile` exit 0)
reproduces the identical failure. Log: `/tmp/fn112-build-probe-base.log`;
worktree removed after the probe. `build` is not one of the five CBC commands,
is not in `prerelease` (`lint:check` + `test`), and the publish path uses
`build:css`, which passes.

## Stale built CSS found and fixed by this gate

`bun run build:css` changed `src/serve/public/globals.built.css`, which was
**stale at `c9b828eb`**. This file ships in the npm package, so the staleness
was real, not cosmetic. Exact class-set delta:

- **Added (2), both required and previously missing**: `min-w-[4.25rem]` and
  `min-w-[6rem]` — used by `PdfToolbar.tsx:257` (zoom-level combobox trigger)
  and `:266` (its dropdown content). Without them the PDF toolbar's zoom
  control shipped without its minimum widths.
- **Dropped (5), all verified dead**: `min-w-[3.25rem]` (0 source uses);
  `backdrop-filter` and `ease-in-out` (present in `globals.css` only as raw CSS
  property/keyword, never as utility classes); `bg-yellow-500/30` and
  `text-inherit` (used only inside `@apply` in `globals.css`, which inlines the
  declarations — the standalone utilities are not needed). Verified no visual
  regression: the generated `mark` rule is byte-identical between the committed
  and rebuilt files.

## Scope discipline

Rerunning `test:e2e:pdf` regenerated `.flow/reviews/fn-112-task-6-evidence/*`,
overwriting artifacts that Sol already accepted at round 7 for task .6. Those
were restored to their committed state (`git checkout --`), so task .6's
accepted evidence and its `artifact-hashes.json` remain exactly as reviewed.
This task's own passing e2e run is recorded here in `06-e2e-pdf.log` instead.

Final task .7 delta is limited to: `CHANGELOG.md`, `docs/API.md`,
`docs/WEB-UI.md`, `src/serve/CLAUDE.md`, `src/serve/AGENTS.md`,
`website/_data/features.yml`, `src/serve/public/globals.built.css`,
`.flow/handoff/`, and `.flow/reviews/fn-112-task-7-gates/`.

## Hosted site (`gno.sh`)

Not touched, not QA'd, not deployed — out of this engagement's authorized
scope. `/home/claw/work/gno.sh` does not exist in this environment. The
ready-to-apply change brief is `.flow/handoff/fn-112-gno-sh-docs-brief.md`.
That brief is a completion dependency of this spec; executing it in the site
repo is an **external post-merge owner handoff** and is not.
