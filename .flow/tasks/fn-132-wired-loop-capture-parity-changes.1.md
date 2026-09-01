---
satisfies: [R4, R5, R6]
---
# fn-132-wired-loop-capture-parity-changes.1 Staged resumable indexing + crash investigation

## Description
Staged resumable indexing + crash investigation. **Size:** L. **Files/Touches:** src/cli/commands/index-cmd.ts (NOTE: current code discards a failed embed result and returns success:true — that exit-0-on-embed-failure defect is in scope to fix), src/cli/commands/embed.ts, src/embed/** (extend backlog/cursor persistence), receipts + output schema, test kill-9 resume.
Receipt contract (binding): stages lexical|embed each report state completed|failed|skipped|interrupted with counts; overall exit = 0 only when every attempted stage completed (embed failure → non-zero with partial receipt); a SIGKILLed process emits nothing — the NEXT run's resume preamble reports the interrupted stage and continues from persisted progress. Investigate the Bun 1.3.14 combined-run crash (field report 2026-09-01) as far as evidence allows; R5 honesty: root-cause+guard OR documented sidestep. Reuse fn-130's lease/sync helpers (spec dependency on fn-130 now encoded).

**Touches:** src/cli/commands/index-cmd.ts, src/cli/commands/embed.ts, src/embed/**, receipt output schema, kill-9 resume test

## Acceptance
- [ ] Embed-stage failure yields non-zero exit + per-stage receipt (fixes today's exit-0 defect; regression test)
- [ ] kill -9 during embed: lexical remains valid; rerun's preamble reports interrupted stage; embedding resumes without re-embedding completed chunks (live test)
- [ ] Receipt schema committed; gno index --json carries per-stage states/counts
- [ ] Crash finding documented either way (root cause + guard, or evidence-bounded sidestep note)

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
