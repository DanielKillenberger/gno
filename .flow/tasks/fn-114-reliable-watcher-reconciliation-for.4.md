---
satisfies: [R7, R8]
---
# fn-114-reliable-watcher-reconciliation-for.4 Integrated verification, large-directory measurement, and documentation reconciliation

## Description
Close the spec: run the full gate set, measure the large-directory cost the risk
section calls out, prove the real-filesystem lifecycle end to end, and reconcile every
piece of documentation the change touches. Docs, CHANGELOG, and any contract wording
land here as ONE task, not one per artifact.

**Size:** M
**Files:**
- `CHANGELOG.md` (`[Unreleased] / ### Fixed`)
- `docs/TROUBLESHOOTING.md` (~`:380-394`, "Daemon is running but nothing updates")
- `docs/WEB-UI.md` (~`:460-475`, "Background Reliability")
- `docs/ARCHITECTURE.md` (~`:178`, the "path-scoped ingestion" sentence)
- `docs/DAEMON.md` (the "reacts only to future file changes" framing)
- `docs/API.md` + `spec/output-schemas/status.schema.json` + `spec/cli.md` — ONLY if
  task `.3` changed the public watcher status shape
- a large-directory measurement recorded in task evidence

### Approach

- Run the canonical gates from `package.json`: `bun run lint:check`,
  `bun run typecheck`, `bun test`, plus `git diff --check`.
- Run the real-filesystem smoke from task `.1` on the platform available here, and on
  Linux where the runtime allows — the Linux run is the proof that closes the reported
  defect. Record command + output as evidence.
- Large-directory measurement — the fixture and the criterion are FIXED by the spec so
  the result can fail, not merely be declared acceptable:
  - fixture: one directory containing 5,000 eligible files, 500 excluded files, and
    200 active-indexed-but-missing paths;
  - method: five warm runs of a single ambiguous event; report the median; time
    enumeration, the store query, and the unchanged-`syncPaths` pass SEPARATELY so the
    limiting stage is identifiable;
  - criterion: enumeration + store query together at or under 250 ms median.
  Exceeding the criterion is not a scope-expansion trigger — record the numbers and
  document the ceiling as a known limitation in `docs/TROUBLESHOOTING.md`. Do not batch
  or paginate in this slice.
- Documentation: describe the new behavior in user terms — atomic saves and deletions
  are now picked up without a manual `gno update`, reconciliation is bounded to the
  changed directory. Follow the CHANGELOG house style (concrete cause, concrete fix);
  the `1.29.6` "Filtered resident watcher events" entry is the tone reference.
- Per CLAUDE.md, if the public status shape changed, `spec/output-schemas/status.schema.json`,
  its contract test under `test/spec/schemas/`, `docs/API.md`, and `spec/cli.md` must
  agree. Verify with `bun test test/spec/`.
- Check the hosted site repo `~/work/gno.sh` for pages describing watcher behavior /
  auto-indexing / the "why didn't it refresh?" failure mode. If a change is needed
  there, it is a separate change in that repo — record what needs updating in the task
  evidence rather than editing it from this worktree.

### Investigation targets

**Required:**
- `CHANGELOG.md` — `[Unreleased]` section and the `1.29.6` entry as a style reference
- `docs/TROUBLESHOOTING.md:380-394`
- `docs/WEB-UI.md:460-475`
- `docs/ARCHITECTURE.md:178`
- the final diff from tasks `.2` and `.3` — documentation must describe what shipped

**Optional:**
- `docs/DAEMON.md`, `spec/cli.md:1727-1760`, `website/_data/features.yml:45-52`

### Key context

- Documentation drift is a stated project rule: behavior change and docs land together.
- `website/docs/` is auto-synced from `docs/` at build time — do not hand-edit it.
- Do not bump the package version here. Versioning happens on merge to main per the
  project's post-merge workflow.

### Acceptance

- [ ] `bun run lint:check`, `bun run typecheck`, `bun test`, and `git diff --check` all
      pass, with commands and output recorded as evidence
- [ ] Real-filesystem smoke run and recorded; the Linux run is included or its
      unavailability is explicitly stated
- [ ] Large-directory measurement run on the specified fixture (5,000 eligible / 500
      excluded / 200 active-missing), five warm runs, median reported, with enumeration,
      store query, and `syncPaths` timed separately
- [ ] The large-directory run re-confirms the store query stays index-served at fixture
      scale (query plan unchanged from task `.2`'s evidence)
- [ ] Enumeration + store query median compared against the 250 ms criterion; a miss is
      recorded with numbers and documented as a known limitation in
      `docs/TROUBLESHOOTING.md`
- [ ] `CHANGELOG.md` `[Unreleased] / ### Fixed` describes the fix in house style
- [ ] `docs/TROUBLESHOOTING.md`, `docs/WEB-UI.md`, `docs/ARCHITECTURE.md`, and
      `docs/DAEMON.md` describe the shipped behavior, with no remaining claim that a
      manual `gno update` is required for atomic saves or deletions
- [ ] If the watcher status shape changed: `spec/output-schemas/status.schema.json`,
      its contract test, `docs/API.md`, and `spec/cli.md` agree and `bun test test/spec/`
      passes. If it did not change, state that explicitly
- [ ] Any `~/work/gno.sh` page needing an update is identified and recorded in evidence
- [ ] No package version bump in this task

## Acceptance
- [ ] lint:check, typecheck, full bun test, and git diff --check pass with recorded output
- [ ] Real-filesystem smoke executed and recorded; Linux run included or explicitly unavailable
- [ ] Large-directory cost measured with stated fixture size; acceptable or documented as a limitation
- [ ] CHANGELOG [Unreleased] Fixed entry in house style
- [ ] TROUBLESHOOTING, WEB-UI, ARCHITECTURE, DAEMON docs match shipped behavior
- [ ] Status contract files agree if the shape changed, or no-change stated explicitly
- [ ] ~/work/gno.sh updates identified and recorded
- [ ] No version bump


## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
