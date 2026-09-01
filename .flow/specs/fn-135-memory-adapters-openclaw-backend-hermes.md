## Goal & Context

Put GNO's memory into the slots harnesses actually call, now that the contracts exist (fn-130) and pass the eval gate (fn-134). Three deliverables: the OpenClaw search-backend, a Hermes memory provider, and the fn-129 block version bump that adds the memory rungs to the ladder. Strategy note gap 1 / build 3b.

## What

1. **OpenClaw `memory.backend = "gno"`.** Same shell-out shape as the existing qmd backend: OpenClaw owns and writes its memory files; GNO provides hybrid retrieval over them (search-backend mode — read-only write authority, per the decided architecture). Deliverable is whatever OpenClaw's extension surface requires (config + adapter script or upstream PR — investigate their backend contract first; qmd's integration is the template). Configurable paths (memory dir, extra paths e.g. an Obsidian vault), BM25-default with optional semantic, snippets with gno:// attribution where representable.
2. **Hermes memory provider** as an external plugin per Hermes's provider policy (prefetch / sync_turn / shutdown hooks): prefetch calls `recall` with the turn's query and scopes from provider config; sync_turn optionally offers `remember` for explicit memory decisions (never ambient auto-store — configuration decides; default conservative). Managed-memory mode: writes go through the fn-130 contracts only.
3. **Block bump (fn-129 mechanism):** ladder gains the memory rungs — `gno recall` near the top for "what do we know/believe" questions, `gno remember` in the writing contract with the add/supersede decision language and the fence note. `gno agents update` migrates installed blocks.
4. **Skill update** covering the memory workflows (recipes: filing a decision, superseding a stale fact, scoped recall) — and per repo rules, the autoresearch skill eval question is explicitly Gordon's call at land time (recorded; default per 2026-09-01 instruction: not required).

## Constraints

- Write authority stays unambiguous: OpenClaw backend never writes; Hermes provider writes only via remember with explicit scopes from its config.
- Both adapters are external artifacts (plugin/config), not forks; upstream PRs only where the harness requires in-tree registration.
- Version pinning: adapters declare the minimum GNO version (fn-130's) they need and fail with a clear message below it.

## Acceptance Criteria

- R1: OpenClaw with `memory.backend = "gno"` performs memory_search over its own memory files through GNO retrieval; a fresh-session protocol canary retrieves a seeded memory fact. Verified live in a real OpenClaw workspace.
- R2: Hermes with the GNO provider prefetches recall results into a turn and can store an explicit fact through remember with scopes; verified live via a scripted Hermes session; no ambient store occurs with default config.
- R3: `gno agents update` migrates an installed v1 block to the memory-rung version; block still passes size budget and copy rules; ladder ordering per the decided shape.
- R4: Skill memory recipes ship; docs updated (MEMORY.md adapters section, integrations pages deferred to site follow-up).
- R5: Both adapters gated on fn-134 green at documented thresholds (recorded in the spec on start).

## QA environment

OpenClaw and Hermes are not guaranteed on the build machine. Live verification runs wherever the harness actually exists (the operator's fleet exposes an OpenClaw workspace on heimdall and Hermes on ivan, reachable over SSH) or via a scratch local install when the harness supports one. When neither is autonomously feasible, the QA stage reports NEEDS_HUMAN with the prepared verification script attached — never a source-read PASS.

## Boundaries

- Out: Claude Code/Cursor adapters (instructions + tool descriptions already cover them; no hook adapters per the decided direction).
- Out: PreCompact nudge (still deferred).
- Out: consolidation, entities, temporal (unchanged roadmap).
- Out: marketplace listings/announcements (fn-133 and later).

## Pilot routing

plan (three deliverables across two external ecosystems plus the block bump).
