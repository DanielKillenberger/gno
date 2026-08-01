# Durable Hermes continuation — task 6 Sol repair loop

You are the sole durable workflow owner for `/home/claw/work/gno-pdf-renderer`, branch `feat/native-pdf-renderer`, Flow `fn-112-native-pdfjs-document-renderer`.

Daniel explicitly said to continue the build. Resume from repository truth and continue autonomously to verified PR creation or a genuine blocker.

## Frozen routing

- Builder and implementation repairs: canonical `claude-opus-5`, exactly `--model opus --effort medium`, Max/OAuth, through `bash /home/claw/.hermes/skills/autonomous-ai-agents/multi-model-orchestration/scripts/run-claude-no-telegram.sh`, with explicit Flow Next plugin `/home/claw/.claude/plugins/cache/flow-next/flow-next/3.5.1`, no inherited user settings/hooks/channels.
- Resume Claude session `591fe567-0984-4051-9065-563da909a27d` when valid; every resumed invocation must still specify `--model opus --effort medium`.
- Independent reviewer: Sol via `/home/claw/.npm-global/bin/codex`, model `gpt-5.6-sol`, prompt argument with stdin closed.
- No Grok. No silent substitution. One writer at a time.

## Current authoritative lifecycle

- Plan: `SHIP`, `ready=true`.
- Tasks `.1`–`.5`: accepted with Sol `SHIP` receipts.
- Task `.6`: Flow `in_progress`, unaccepted.
- Sol task-.6 implementation review round 1: `NEEDS_WORK`, receipt `.flow/reviews/fn-112-sol-impl-review-task-6.json`.
- Task `.7`: todo.
- Completion review: not run.
- No commit, push, PR or merge.
- Baseline HEAD remains `bb994b580356a41a31093fea85b06993c1a18e4c`; current fn-112 state is uncommitted.
- At this handoff, no Hermes/Claude/Codex/Grok writer or PDF smoke process owns this checkout.

## Round-1 Sol findings

Read the complete receipt; both blockers must close non-vacuously:

1. `SOL6-IMPL-01`: P-4b evidence had an entry-state setup race. The alleged superseded/replacement generations were mis-correlated; no separate replacement generation appeared. Required: positively observe entry-state generation start and matching completed settle before reset/baseline; correlate initiating target generation; require a distinct replacement generation; prove replacement renderStart scale/fit-derived dimensions and completed settle for 210% (A) and fit-page (B); regenerate ladder/events and rerun complete e2e.
2. `SOL6-IMPL-02`: `startRenderAdmitted` failed to revalidate full canvas identity/connectivity after awaits. Required: after every await validate doc/gen/epoch, active membership, `canvasRef.current.get(pageNumber) === canvas`, and `canvas.isConnected`; deterministic held-`getPage` canvas replacement/disconnection test proving zero renderStart/hidden metrics/backing allocation on stale canvas.

## Partial repair state to adopt

The same Opus session attempted two repair continuations:

- `.flow/reviews/fn-112-opus5-task6-repair-sol-round1.events.jsonl` — hit 100-turn ceiling.
- `.flow/reviews/fn-112-opus5-task6-repair-sol-round2.events.jsonl` — ended `aborted_streaming` after 35 turns.
- Read their prompts/stderr/event tails and current diff. Treat edits as unapproved partial state; verify rather than trust.
- The earlier implementation transaction receipt claimed all pre-review gates green, but Sol invalidated P-4b and found the stale-canvas product gap. Do not rely on its `ready_for_sol_review` flag until both findings are repaired and fresh evidence passes.

## Required continuation

1. Re-anchor on repository instructions, task `.6`, approved performance plan repair Sol `SHIP` round 3, Sol implementation receipt, current diff, both Opus repair streams, and current evidence directory.
2. Resume exact Opus session at medium effort with a delta-only prompt covering both findings and incomplete prior repairs. Inspect for already-landed valid code; do not replay finished work. Continue through ordinary failures and turn ceilings with serial delta continuations.
3. Require focused deterministic stale-canvas tests plus fresh authoritative `bun run test:e2e:pdf` evidence for P-4b. Rerun every affected task-.6 gate and update truthful receipts. Do not weaken thresholds/oracles.
4. Run independent Sol task-.6 re-review round 2. Every remaining `NEEDS_WORK` finding returns to Opus medium and re-review until `SHIP`.
5. Only after Sol task-.6 `SHIP`, formally complete/accept `.6` and activate `.7`.
6. Opus medium implements `.7`; exact gates; Sol task review; repair/re-review to `SHIP`.
7. Run independent spec-completion-review; Opus repairs and Sol re-reviews until `SHIP`.
8. Run all approved integrated browser/security/performance/package/full-suite/docs/QA gates with exact evidence.
9. After all gates pass: create coherent local commits, push `feat/native-pdf-renderer`, open authorized PR, verify URL/readback/CI. Never merge.

## Hard constraints

- Direct native PDF.js in existing `/doc`; no iframe/object/embed/CDN.
- Preserve accepted tasks `.1`–`.5`.
- Do not touch `/tmp/gno-native-pdf-investigation`, Daniel-OS, GNO collections, Threshold, gno.sh or unrelated repositories.
- Ordinary test failures, `NEEDS_WORK`, turn/context ceilings and coordinator boundaries are continuation points.
- Stop only for genuine authentication/quota/nonrecoverable environment/safety blockers.
- Flow state, implementation phase, reviewer verdict, test status and acceptance are separate facts. Do not call `.6` accepted before Sol `SHIP`.
- Publication authorized only after all gates; merge remains unauthorized.

Return only after a verified PR or genuine blocker, with exact review rounds/findings, gate results, commits, pushed branch, PR URL/readback and remaining blockers.