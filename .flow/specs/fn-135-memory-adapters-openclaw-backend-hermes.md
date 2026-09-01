## Goal & Context

Put GNO's memory into the slots harnesses actually call, now that the contracts exist (fn-130) and pass the eval gate (fn-134). Three deliverables, in priority order: a Hermes memory provider (the operator's actively used hook harness, on ivan — real dogfood), the fn-129 block version bump adding the memory rungs, and the OpenClaw search-backend (market-driven: OpenClaw is the qmd slot and its user base is the audience; the operator's own OpenClaw is dormant, so it earns no fleet dogfood). Strategy note gap 1 / build 3b.

## What

1. **OpenClaw memory plugin — INTERFACE CORRECTED (plan review, 2026-09-01):** OpenClaw 2026.8.1 retired `memory.backend` and removed the qmd backend; external memory now ships as a `kind: "memory"` plugin selected via `plugins.slots.memory` (docs/tools/plugin.md — RE-VERIFY at execution start). OpenClaw owns and writes its memory files; GNO retrieves (read-only authority). Corpus provisioning is explicit: plugin init registers the workspace memory paths as a GNO collection; writes reach the index via sync-before-search or watch mode (decided in-task, documented); deletion reconciliation and runtime-state exclusion covered. Differentiators (corrected — OpenClaw has local GGUF embeddings via memory.search.provider local, so "no API key" is NOT ours): one index across every harness and format, gno:// cited snippets with hashes, the evidence layer, scoped recall.
2. **Hermes memory provider** as an external plugin: prefetch calls `recall` (turn query + configured scopes); explicit store operations are exposed via `get_tool_schemas()`/`handle_tool_call()` (Hermes's mechanism for deliberate ops) with add/supersede inputs and caller/session identity mapping from provider config + turn context; `sync_turn` — which Hermes fires after EVERY turn — performs NO GNO writes (ambient store would violate the architecture). Managed-memory mode: writes go through the fn-130 contracts only.
3. **Block bump (fn-129 mechanism):** ladder gains the memory rungs — `gno recall` near the top for "what do we know/believe" questions, `gno remember` in the writing contract with the add/supersede decision language and the fence note. `gno agents update` migrates installed blocks.
4. **Skill update** covering the memory workflows (recipes: filing a decision, superseding a stale fact, scoped recall) — and per repo rules, the autoresearch skill eval question is explicitly Gordon's call at land time (recorded; default per 2026-09-01 instruction: not required).

## Constraints

- Write authority stays unambiguous: OpenClaw backend never writes; Hermes provider writes only via remember with explicit scopes from its config.
- Both adapters are external artifacts (plugin/config), not forks; upstream PRs only where the harness requires in-tree registration.
- Version pinning: adapters declare the minimum GNO version (fn-130's) they need and fail with a clear message below it.

## Acceptance Criteria

- R1: Hermes with the GNO provider prefetches recall results into a turn and can store an explicit fact through remember with scopes; verified live via a scripted Hermes session on ivan; no ambient store occurs with default config.
- R2: OpenClaw with the GNO memory plugin selected via `plugins.slots.memory` performs memory search over its own memory files through GNO retrieval; a fresh-session protocol canary retrieves a seeded memory fact, and a file written AFTER plugin init is retrievable. Verified live in the scratch OpenClaw workspace.
- R3: `gno agents update` migrates an installed v1 block to the memory-rung version; block still passes size budget and copy rules; ladder ordering per the decided shape.
- R4: Skill memory recipes ship; docs updated (MEMORY.md adapters section, integrations pages deferred to site follow-up).
- R5: Both adapters gated on fn-134 green at documented thresholds (recorded in the spec on start).

## QA environment

Hermes lives on ivan (actively used; reachable over SSH) — that is the real-dogfood verification target. OpenClaw: the operator's heimdall install is dormant and NOT a meaningful QA target; a fully isolated scratch OpenClaw is ALREADY PROVISIONED at `~/work/sandbox/openclaw-dogfood/` (launcher `./openclaw-sandboxed` pins OPENCLAW_HOME/STATE_DIR/CONFIG_PATH/WORKSPACE_DIR and HOME itself — OPENCLAW_HOME alone leaks state, observed 2026-09-01; leak-check verified clean). Workspace is seeded with MEMORY.md + memory/2026-09-01.md canaries ("amber-falcon-72", "teal-heron-19"). OpenClaw 2026.8.1. Verified 2026-09-01: `openclaw memory search` works unauthenticated over the keyword path (canaries retrieved), so backend verification needs no credentials; OpenClaw's own SEMANTIC memory path fails without an OpenAI API key (memory index errors on missing provider auth; vector recall degraded). Full agent turns need model auth (`openclaw models auth paste-api-key --provider openai` or subscription login). Positioning correction from plan review: OpenClaw supports local GGUF embeddings natively (memory.search.provider: local), so the earlier "no API key" observation reflected default config, not a capability gap — do not ship that claim. The honest differentiators are the cross-harness/cross-format index, cited+hashed recall, evidence layer, and scopes. When a live target is not autonomously feasible, the QA stage reports NEEDS_HUMAN with the prepared verification script attached — never a source-read PASS.

## Boundaries

- Out: Claude Code/Cursor adapters (instructions + tool descriptions already cover them; no hook adapters per the decided direction).
- Out: PreCompact nudge (still deferred).
- Out: consolidation, entities, temporal (unchanged roadmap).
- Out: marketplace listings/announcements (fn-133 and later).

## Pilot routing

plan (three deliverables across two external ecosystems plus the block bump).
