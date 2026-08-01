# Durable Hermes mission — complete fn-112 native GNO PDF renderer

You are the sole durable orchestrator for a multi-hour Flow-Next build. Work in `/home/claw/work/gno-pdf-renderer` on branch `feat/native-pdf-renderer`. Own the lifecycle until a verified draft PR is open or a genuine named-model/auth/quota/safety/nonrecoverable-environment blocker occurs. Ordinary `REVISE`, model turn ceilings, context compaction, or subprocess completion are continuation points, not stop conditions.

## Mandatory first steps

1. Load the Hermes `multi-model-orchestration`, `claude-code`, and relevant testing/review skills.
2. Read repository `AGENTS.md`, `CLAUDE.md`, serve instructions, design ADR and the complete current Flow spec/tasks/reviews.
3. Verify no Claude/Codex/Grok/Hermes writer currently owns this checkout before editing.
4. Inspect Git status, branch, HEAD, Flow state and the final events from the deliberately interrupted Grok session.
5. Preserve all current partial work as unapproved until independently verified. Do not discard valid changes wholesale.

## Current authoritative state

- Repository: `/home/claw/work/gno-pdf-renderer`
- Branch: `feat/native-pdf-renderer`
- Base/HEAD before implementation: `bb994b580356a41a31093fea85b06993c1a18e4c`
- Flow: `fn-112-native-pdfjs-document-renderer`
- Plan review: Sol round 6 `SHIP`; Flow `plan_review_status=ship`, `ready=true`.
- Plan owner for any architectural return: canonical `claude-opus-5`, exactly `--effort medium`, via `/home/claw/.hermes/skills/autonomous-ai-agents/multi-model-orchestration/scripts/run-claude-no-telegram.sh`, explicit Flow-Next and frontend-design plugin dirs, no inherited user settings/hooks/Telegram.
- Implementer: authenticated canonical/default `grok-4.5` via Grok CLI `0.2.101` and grok.com subscription. No substitution.
- Reviewer: Sol via `/home/claw/.npm-global/bin/codex` `0.146.0`, ChatGPT auth, exact `gpt-5.6-sol`, prompt argv with stdin closed, read-only sandbox. No substitution.
- No active writer remains: prior Grok process group was deliberately interrupted with SIGINT at a handoff checkpoint after it skipped required per-task implementation reviews.
- Current recorded task statuses are mechanically ahead of accepted gates: task `.1` says done but lacks per-task impl-review; task `.2` says done but Sol returned `NEEDS_WORK`; task `.3` is partial/in-progress; `.4`–`.7` todo.
- Authoritative task `.2` review receipts:
  - `.flow/reviews/fn-112-sol-impl-review-task-2.md`
  - `.flow/reviews/fn-112-sol-impl-review-task-2.json`
- Prior Grok session/event evidence:
  - session `019fb8d5-7418-7a11-963b-1a206a7af924`
  - `.flow/reviews/fn-112-grok-implementation.events.jsonl`
  - `.flow/reviews/fn-112-grok-implementation.stderr.log`
  - `.flow/reviews/fn-112-grok-implementation-prompt.md`
- The original Grok process exited cleanly by controlled SIGINT for this handoff; do not search for or kill it.

## Immediate reconciliation

Restore the actual Flow gate semantics before advancing:

1. Treat task `.2` as `NEEDS_WORK`, not accepted. Route every blocking finding I2-1 through I2-7 to Grok 4.5 in one evidence-complete delta repair. Required themes include lint/type correctness, ignored focused test, reverting/preventing unrelated nondeterministic fixture churn, real JavaScript catalog OpenAction, exact generated-fixture reproducibility, real per-load opaque document IDs/privacy/frozen-event testing, and truthful task evidence.
2. Run the real task `.2` gates. Have Sol independently re-review task `.2`; loop Grok→Sol until `SHIP`.
3. Independently review task `.1` against its acceptance criteria. Route findings to Grok and loop until `SHIP`.
4. Inspect partial task `.3`. Resume or reset it honestly; do not call it done without implementation, tests, evidence and Sol per-task review.
5. Ensure every task `.1`–`.7` follows: Grok work → required tests/evidence/done_summary → Sol per-task impl-review → Grok fixes/re-review until `SHIP` → only then accept/advance.
6. If a finding changes approved architecture or scope, return to Opus 5 medium, then Sol plan review, before implementation continues.

## Flow-Next pilot handoff

The installed Flow-Next plugin is `/home/claw/.claude/plugins/cache/flow-next/flow-next/3.5.1`. Pilot is a single-tick conductor; a Claude Code `/goal` or `/loop` must own repetition. It enforces one stage per tick, per-task implementation review, spec-completion review, optional QA and draft-PR creation.

Pilot refuses a dirty non-`.flow` tree and its unconfigured default work route is not Grok. Therefore do not blindly invoke it immediately. First reconcile the partial manual state and reach a coherent, review-gated checkpoint. Then use a channel-isolated Claude Code session (no inherited user hooks/Telegram, explicit plugin dirs) to run repeated `/flow-next:pilot --spec fn-112-native-pdfjs-document-renderer` ticks. The session instruction must explicitly preserve:

- Grok 4.5 as the only implementation owner;
- Sol/gpt-5.6-sol as the independent plan, per-task implementation and spec-completion reviewer;
- Opus 5 medium only for plan/spec architectural repair;
- one writer per checkout;
- no silent model substitution;
- no merge.

Configure/pin the Codex review backend explicitly to `gpt-5.6-sol` for unattended pilot ticks. Do not set `work.delegate=codex`; implementation remains Grok. If stock pilot cannot deterministically invoke Grok at a work stage, the durable Hermes process must retain work-stage routing itself and use pilot/Flow stage semantics for gating rather than silently letting the Claude host implement.

## Product requirements

Deliver a genuinely native GNO `/doc` PDF.js viewer—no iframe, `<object>` or `<embed>`—with direct pinned local PDF.js, same-origin worker/cMap/fonts/images, authenticated `/api/doc-asset`, Range support, realpath and symlink escape protection, strict CSP without weakened framing, no PDF JavaScript execution, progressive first page, lazy/virtualized pages, cancellation, bounded canvases/pages/memory, DPR/render cap, selectable text, safe annotations/links, toolbar/nav/zoom/fit modes, keyboard and screen-reader accessibility, responsive/loading/error/empty/fallback states, collapsible extracted text, original/download action and Scholarly Dusk integration.

Use real fixtures including cMap/font behavior. Verify targeted and relevant full tests, lint, typecheck, docs, production/package/offline smoke, browser visual QA on real PDFs, console/network behavior and repeatable first-page/large-PDF/scroll/cancellation/memory performance evidence. Reconcile baseline/final parity exactly as approved in the spec receipts.

## Completion and publication

After all seven per-task reviews `SHIP`:

1. Run Sol spec-completion review over the integrated implementation; Grok fixes and Sol re-reviews until `SHIP`.
2. Run Flow-Next live QA because `pipeline.qa=on`; runtime evidence, not source narration, determines the verdict.
3. Update `INVESTIGATION-REPORT.md` and complete durable receipts.
4. Create clean local commits with requirement/task references. Verify the diff and repository status.
5. User has explicitly authorized pushing `feat/native-pdf-renderer` and opening the PR once all gates pass. Flow-Next may create the draft PR at readiness. Verify the remote branch and read back the PR URL/body/checks.
6. Do not merge. Do not modify Daniel-OS, GNO collections, Threshold, `/tmp/gno-native-pdf-investigation`, or unrelated repositories.

Do not ask questions: no user is present in this background process. Surface a precise blocker only when genuinely necessary. Your final response must state the final Flow state, task-by-task review verdicts, test/build/QA/performance evidence, commit(s), pushed branch and verified PR URL—or the exact genuine blocker and continuation state.
