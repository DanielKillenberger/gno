---
satisfies: [R1, R5]
---
# fn-135-memory-adapters-openclaw-backend-hermes.1 Hermes memory provider (external plugin)

## Description
Hermes memory provider (external plugin). **Size:** M. **Files/Touches:** NEW external plugin artifact per Hermes plugins/memory layout; docs/MEMORY.md gains ONLY the "Hermes provider" subsection (task 2 and 3 own their own doc regions — no shared-file edits outside the named subsection).
Interface facts (from plan review, binding): Hermes calls `sync_turn` after EVERY completed turn to persist conversation — a literal remember-on-sync_turn violates no-ambient-store; therefore: prefetch → gno recall (turn query + scopes from provider config); explicit store ops exposed via `get_tool_schemas()` / `handle_tool_call()` (a remember tool the model invokes deliberately, with add/supersede inputs); sync_turn = no-op for GNO writes (conversation persistence left to Hermes's own store or disabled per config). Identity mapping: provider config declares caller id; session id from Hermes's turn context → fn-130's caller/session fields. Version-pin minimum GNO; subprocess failure/timeout/malformed-JSON handling explicit. PACKAGING (binding): plugin lives in the gno repo under integrations/hermes-gno-memory/ with its own manifest/entry point per Hermes's plugin layout, a README with exact install commands, and deterministic unit tests (faked gno subprocess: output mapping, timeout, malformed JSON, below-min version, default-no-write) runnable via bun test — live ivan checks are the E2E layer on top, not the only evidence. Record fn-134 eval-green evidence at task start (R5).

**Touches:** integrations/hermes-gno-memory/** (new), docs/MEMORY.md (Hermes subsection — this task is the ONLY fn-135 task touching docs/MEMORY.md in its own change; later tasks append via their own dependent changes)

## Acceptance
- [ ] Scripted Hermes session on ivan: prefetch injects recalled facts; explicit tool call stores a fact via remember; a full session with NO explicit call writes NOTHING (ambient-store negative test)
- [ ] Malformed/missing GNO handled: below-min version and gno-not-found produce clear provider errors, session continues without memory
- [ ] add/supersede inputs mapped and live-verified; scopes come from provider config only
- [ ] docs/MEMORY.md Hermes subsection added (only that region touched)

- [ ] Deterministic unit suite green (faked subprocess cases above)
- [ ] fn-134 gate evidence recorded at start

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
