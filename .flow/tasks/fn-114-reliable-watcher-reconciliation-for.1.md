---
satisfies: [R1, R2, R3, R8]
---
# fn-114-reliable-watcher-reconciliation-for.1 Capture watcher event shapes and establish RED regression coverage

## Description
Prove the real event shape and land a RED regression **before** any product-code change.
Capture what Bun's recursive `fs.watch` actually reports for the four sequences that
matter, then encode the ambiguous-event and deletion cases as deterministic failing
tests against `CollectionWatchService`.

No product code changes in this task. `src/serve/watch-service.ts` must be untouched
when this task completes; the suite is expected to be RED.

**Size:** M
**Files:**
- `test/serve/watch-service.test.ts` (new failing cases)
- one new real-filesystem probe/smoke file under `test/serve/` (name it for the
  watcher, e.g. `watch-service.fs-smoke.test.ts`) — real `mkdtemp`, deterministic
  cleanup, hard timeout, skips cleanly where the runtime cannot support it
- task evidence only (no source edits)

### Approach

- Reuse the existing fake-watcher harness: `watchFactory` captures the callback, then
  the test invokes `watcherCallback(eventType, filename)` directly
  (`test/serve/watch-service.test.ts:11-46`, examples at `:124-136`, `:168-183`).
  `defaultSyncService.syncPaths` / `syncCollection` are monkey-patched per test and
  restored in `afterEach` (`:39-46`) — that is the assertion seam.
- Reuse `createCollection` / `createSyncResult` helpers (`:11-37`).
- For the real-FS probe, `node:fs/promises.mkdtemp(join(os.tmpdir(), ...))` is the
  correct call — Bun has no native mkdtemp (allowed `node:*` per CLAUDE.md).
- Record captured sequences as `(eventType, filename|null)` tuples in the task
  evidence and as fixture constants the later tasks replay.

### Investigation targets

**Required:**
- `src/serve/watch-service.ts:197-220` — the event callback and the eligibility
  rejection this task must prove is the failure point
- `src/serve/watch-service.ts:278-297` — `#queueChange` and the 300 ms debounce that
  governs settle timing
- `test/serve/watch-service.test.ts:11-46` — harness, mocks, `afterEach` restore
- `test/serve/watch-service.test.ts:550-595` — the existing GREEN deletion case; the
  new deletion repro must explain why that one passes while production fails
- `src/ingestion/walker.ts:182-219` — `matchesWalkPath`; it is filesystem-free, which
  is why a deleted `deleted.md` still passes eligibility

**Optional:**
- `src/ingestion/sync.ts:1218-1267` — ENOENT → `markInactive`, for interpreting results

### Key context

- oven-sh/bun#36328: on Linux, atomic temp-write + rename forwards only the SOURCE
  (temp) name — the destination is never reported. This is the expected capture result
  and the root cause of the production evidence.
- oven-sh/bun#33110: watcher queue overflow surfaces as `('change', null)`. Record
  whether a `null` filename ever appears; the current callback path assumes a string.
- macOS collapses create/rename/delete into `eventType === "rename"`; Linux splits
  them. Capture on whichever platform is available and label the capture with the
  platform and Bun version; the Linux capture is the one that closes the report.
- Do not weaken or delete the existing green deletion test to make room — add
  alongside it.

### Acceptance

- [ ] Captured `(eventType, filename)` sequences recorded in task evidence for: direct
      create/write; atomic temp-write + rename; eligible file deletion; atomic
      replacement of an existing eligible file. Each capture labels platform + Bun version.
- [ ] A deterministic test injects the observed ambiguous atomic-create sequence and
      FAILS because the final eligible file is never passed to `syncPaths`.
- [ ] A deterministic test covers the atomic replacement of an existing eligible file
      and fails for the same reason.
- [ ] Deletion coverage reproduces the live stale-active condition, OR the task
      evidence documents precisely why the fake-watcher harness cannot and names the
      smallest real-filesystem seam that can (with that seam added).
- [ ] The real-filesystem probe uses `mkdtemp`, cleans up deterministically, has a hard
      timeout, and skips cleanly rather than hanging where unsupported.
- [ ] Synchronization uses watcher readiness and `onSettled`/callbacks, not a fixed
      sleep standing in for a settle signal.
- [ ] RED command + output preserved as task evidence. `src/serve/watch-service.ts`
      is unmodified by this task.
- [ ] `bun run lint:check` passes on the new test files.

## Acceptance
- [ ] Real Bun event sequences captured and recorded as evidence for all four scenarios, labelled with platform and Bun version
- [ ] Deterministic RED test for the ambiguous atomic-create sequence
- [ ] Deterministic RED test for atomic replacement of an existing eligible file
- [ ] Deletion repro landed, or the event-shape gap documented with the minimal real-FS seam added
- [ ] Real-filesystem probe with mkdtemp, deterministic cleanup, hard timeout, clean skip
- [ ] No fixed sleeps substituting for settle synchronization
- [ ] RED command and output preserved as evidence; no product code modified


## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
