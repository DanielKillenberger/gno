# Durable Hermes continuation — Opus 5 medium is the builder

You are the sole durable workflow owner for `/home/claw/work/gno-pdf-renderer`, branch `feat/native-pdf-renderer`, Flow spec `fn-112-native-pdfjs-document-renderer`.

Daniel explicitly replaced Grok 4.5 as implementation owner. From this checkpoint onward:

- **Builder and implementation-repair owner:** canonical `claude-opus-5`, exactly `--model opus --effort medium`, Max/OAuth, launched only through:
  `/home/claw/.hermes/skills/autonomous-ai-agents/multi-model-orchestration/scripts/run-claude-no-telegram.sh`
- Invoke that launcher through `bash` (the file is intentionally not executable).
- Exclude user settings/hooks/channels using the launcher. Load required plugins explicitly with `--plugin-dir`; Flow Next 3.5.1 is at `/home/claw/.claude/plugins/cache/flow-next/flow-next/3.5.1`. Add frontend-design only if genuinely required.
- **Independent plan and implementation reviewer:** Sol through `/home/claw/.npm-global/bin/codex`, explicit model `gpt-5.6-sol`, ChatGPT auth, prompt passed as an argument with stdin closed.
- No Grok calls. No silent model substitution.

A live preflight immediately before this continuation verified `claude-opus-5`, medium effort, successful Max/OAuth invocation, and exact result `OPUS5_MEDIUM_READY`.

## Verified checkpoint

- Latest HEAD remains `bb994b580356a41a31093fea85b06993c1a18e4c`; all fn-112 work is uncommitted and preserved.
- Branch: `feat/native-pdf-renderer`.
- Plan status: `ship`, `ready=true`.
- Targeted task-.6 progressive plan repair: Sol `SHIP`, round 2, receipt `.flow/reviews/fn-112-sol-plan-rereview-task6-progressive-round2.json`.
- Tasks `.1`–`.5`: Flow `done`; existing independent Sol implementation `SHIP` receipts preserved.
- Task `.6`: Flow `in_progress`, not accepted, no implementation-review `SHIP`.
- Task `.7`: `todo`.
- Completion review: not run.
- No commit, push, PR, or merge.
- Previous Grok writer stopped on HTTP 402 balance exhaustion; no Grok/Claude/Codex writer remained active at handoff.

## Task .6 implementation truth

Substantial partial task-.6 work exists. Treat it as unapproved state: inspect and preserve correct work, remove invalid experiments, and verify every claim yourself.

Verified progress before Grok stopped:

- Focused PDF loader tests passed.
- Smoke startup diagnostics were improved to drain/capture bounded server stdout/stderr and report early exit/log tails.
- Clean browser mode previously passed offline/security/CSP checks, JS-action inertness, and P-1 budgets:
  - small PDF: 618 ms (budget <=1500 ms)
  - large PDF: 2049 ms (budget <=3000 ms)
- Progressive mode reached real Range loading and first-page paint.
- The approved progressive plan uses a genuine initial HTTP 200, then observable byte-correct Range requests with `disableStream` and `disableAutoFetch`; rejected fetch bridges, synthetic first-chunk responses, full-body workarounds, and falsified headers must remain absent.
- The remaining progressive assertion delta at the prior checkpoint was to make page 2 content begin beyond the first 64 KiB so at least one later Range can remain held while page 1 is painted and a placeholder coexists.
- The last authoritative full-smoke attempt then failed before browser assertions at server health:
  `large fixture bytes=723311 pages=200; Indexing collection…; Timed out waiting for health at http://127.0.0.1:44048; exit 1`.
- The previous owner had instructed the writer to repair startup diagnostics first, rerun, expose the actual startup failure, and fix only the relevant product/task-.6 issue. Inspect current diff and all post-plan/Grok event logs to determine how much of that repair landed.

## Required continuation

1. Verify there is no competing writer. Read `AGENTS.md`, all applicable nested instructions, `CLAUDE.md`, the full current spec/task `.6`, Sol plan-repair receipts, current diff/status, and all latest task-.6 continuation/event logs.
2. Launch one Opus 5 medium editing transaction with a self-contained evidence packet. Opus must explicitly accept ownership of the partial Grok state, inspect rather than trust it, and disposition every remaining acceptance item.
3. Continue task `.6` until all literal acceptance criteria pass. Ordinary failures, turn ceilings and `NEEDS_WORK` are continuation points; resume or launch delta-only Opus medium calls serially.
4. Required task-.6 gates include the authoritative `bun run smoke:pdf-viewer` / `bun run test:e2e:pdf`, package smoke, focused tests, `bun run test:web`, `bunx tsc --noEmit`, and `bun run lint:check`, plus complete durable evidence artifacts and truthful receipt. Do not weaken thresholds or classify product/harness failures as environmental without proof.
5. After implementation is genuinely complete, mark it done-awaiting-review truthfully and run independent Sol task-.6 implementation review. Return every `NEEDS_WORK` finding to Opus 5 medium and re-review until Sol `SHIP`. If review requires an architecture change, repair plan with Opus medium and repeat Sol plan review before implementation continues.
6. Only after task `.6` receives Sol `SHIP`, formally activate task `.7`. Opus 5 medium implements docs/changelog/final gates. Run independent Sol review and repair until `SHIP`.
7. Run independent `spec-completion-review`; repair with Opus 5 medium and re-review until `SHIP`.
8. Run all integrated QA/security/performance/browser/package/docs/full-suite gates from the approved plan and preserve exact evidence.
9. After every gate passes, create coherent local commits, push `feat/native-pdf-renderer`, open the authorized PR, and verify URL/readback/CI. Do not merge.

## Hard constraints

- One writer per checkout; external model calls serial.
- Direct native PDF.js in existing `/doc`; no iframe/object/embed/CDN.
- Do not touch `/tmp/gno-native-pdf-investigation`, Daniel-OS, GNO collections, Threshold, `gno.sh`, or unrelated repositories.
- Preserve tasks `.1`–`.5` accepted behavior.
- Keep Flow status, reviewer verdict, implementation phase, test status, and acceptance separate and truthful.
- Do not stop on ordinary errors or model turn ceilings. Stop only for genuine auth/quota/nonrecoverable environment/safety blockers.
- Publication authorization: local commits, push feature branch, open PR after all gates. Never merge without separate approval.

Continue autonomously to a verified PR or a genuine blocker. Final response must state exact task verdicts, review rounds/findings, gate commands/results, commit IDs, pushed branch, PR URL/readback and remaining blockers.