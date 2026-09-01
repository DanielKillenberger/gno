---
satisfies: [R2, R6]
---
# fn-132-wired-loop-capture-parity-changes.3 gno changes --follow --jsonl

## Description
gno changes --follow --jsonl. **Size:** M. **Files/Touches:** src/cli/commands/changes*, journal read path, NEW spec/output-schemas/changes-follow-event.schema.json, docs/CLI.md + spec/cli.md, tests.
Wire contract (binding): one JSON object per line = {event, postCursor} where postCursor is the cursor AFTER applying that event (checkpoint rule: consumer persists postCursor, resume with --cursor replays nothing before it); default start = current latestCursor (tail semantics) unless --cursor given; quiet periods emit nothing (no keepalive in v1; document); cursor-expiry → one terminal error record {error:"cursor_expired", earliestCursor} (the journal's documented resume floor — resuming from latestCursor would skip every retained event; consumer decides whether to backfill from earliestCursor or tail) then non-zero exit; SIGINT → clean exit. At-least-once with idempotent postCursor checkpointing documented as the delivery contract. Scripted-edit-sequence test: restart mid-stream, prove no gap/duplicate by event ids.

**Touches:** src/cli/commands/changes*, journal read path, spec/output-schemas/changes-follow-event.schema.json (new), docs/CLI.md, spec/cli.md, tests

## Acceptance
- [ ] Schema committed; per-line shape validated in tests
- [ ] Restart-resume test proves no gap/no duplicate against a scripted edit sequence
- [ ] Cursor-expiry and SIGINT behaviors verified
- [ ] docs/CLI.md + spec/cli.md in the same change

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
