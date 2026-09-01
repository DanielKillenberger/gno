## Goal & Context

Ship the operator-wired loop as product, and harden the indexing pipeline that loop depends on. Three loop pieces (strategy note gap 5) plus one field-reported reliability defect: during the 2026-09-01 reference deployment, Bun 1.3.14 on Linux (Thor) crashed once during combined `gno index` (sync + embed in one process); splitting into `gno index --no-embed` followed by `gno embed` completed cleanly. The loop is only trustworthy if its stages are independently resumable and crash-recoverable.

## API Contracts

1. **Capture-and-index as one job.** The MCP `gno_capture` path (and REST capture) completes write + lexical sync under the shared write lease before returning success, so a captured note is retrievable in the same agent turn (CLI capture already syncs; bring the other surfaces to parity). Receipt distinguishes write receipt from sync receipt (and from embed state, which stays separate per the reliability contract below).
2. **`gno changes --follow`.** Streaming mode over the existing cursor-based change journal: `--follow --jsonl` emits change events as they land (long-poll or watch-driven), persisting/echoing opaque cursors so a consumer can resume exactly. This is the durable automation input for routines; no scheduler is added.
3. **Scheduled findings pass.** `gno daemon` gains an opt-in scheduled task that runs the existing read-only audit on a configurable cadence and writes findings as records into an operator-configured findings collection — queryable through normal retrieval. Report-only: never repairs, never mutates sources or config. Off by default. Saved-Capsule reverification is explicitly OUT of this pass: its scheduler is journal-driven by design and a cadence call is a no-op between changes; it stays as-is.
4. **Staged, resumable indexing (the hardening).** Reproduce/diagnose the combined index+embed crash path as far as evidence allows; regardless of root cause, make the contract crash-safe: lexical sync and embedding run as separable stages with persisted progress (embedding already has backlog/cursor machinery — extend so an interrupted combined run resumes without rework or corruption); a crash in the embed stage never invalidates the completed lexical stage; `gno index` reports per-stage receipts. Document the recovery story.

## Edge Cases & Constraints

- All writes remain under the v1.38.0 write lease; the findings pass and follow-mode readers must not block writers.
- `--follow` consumers that disconnect resume from their cursor with no gaps and no duplicates (at-least-once with idempotent cursor semantics is acceptable if documented).
- Findings records carry provenance (which check, when, evidence pointers) and are ordinary records (egress, retrieval, deletion via normal file rules).
- Daemon scheduling must be quiet: no output when nothing found; bounded runtime; skips when a writer holds the lease rather than queuing behind long embeds.

## Acceptance Criteria

- R1: MCP `gno_capture` returns only after the note is lexically retrievable; verified live in one agent turn (capture → immediate search hit) with the lease held-and-released correctly under a concurrent writer.
- R2: `gno changes --follow --jsonl` streams events for live edits, survives consumer restart via cursor resume with no gap/duplicate against a scripted edit sequence. Verified live.
- R3: The scheduled findings pass writes audit findings as records into the findings collection on cadence, report-only; a run with nothing to report writes nothing and logs nothing beyond debug. Verified live with a seeded broken link.
- R4: Kill -9 during the embed stage of `gno index`: lexical results remain valid, rerun resumes embedding from persisted progress without re-embedding completed chunks, exit receipts show both stages. Verified live.
- R5: The combined-run crash path is either root-caused with a regression guard, or the staged contract demonstrably sidesteps it (documented finding either way, linked to the field report).
- R6: Docs: CLI.md (changes --follow, index stage receipts), MCP.md/API.md (capture parity), a daemon docs section for the findings pass; spec/cli.md + output schemas for new/changed outputs; all in the same change.

## Boundaries

- Out: MCP subscription mapping of the change stream (later, on fn-131's foundation).
- Out: any auto-repair in the findings pass.
- Out: new scheduler infrastructure beyond the daemon's existing task loop.
- Out: webhooks/external event sinks.

## Pilot routing

plan (pre-planned, SHIP) — dispatch the work stage via `/flow-next:work-rolling <this-id> mode:autonomous` (tasks mostly parallel).
