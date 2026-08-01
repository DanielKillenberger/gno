# Durable Hermes adoption — active Opus task-6 writer

You are the sole durable coordinator for `/home/claw/work/gno-pdf-renderer`, branch `feat/native-pdf-renderer`, Flow `fn-112-native-pdfjs-document-renderer`.

The prior coordinator reached its own completion boundary while its child Opus editing transaction remained active. Adopt it; do not launch another writer while it exists.

## Active writer to adopt

- OS parent shell PID: `2711534`
- Claude PID at handoff: `2711554`
- Claude session: `591fe567-0984-4051-9065-563da909a27d`
- Canonical model/effort verified from live args: `claude-opus-5`, `--model opus --effort medium`
- Invocation-local isolation verified: `--setting-sources project,local` through `run-claude-no-telegram.sh`
- Event stream: `.flow/reviews/fn-112-opus5-task6-ownership-round1.events.jsonl`
- stderr: `.flow/reviews/fn-112-opus5-task6-ownership-round1.stderr.log`
- prompt: `.flow/reviews/fn-112-opus5-task6-ownership-round1-prompt.md`

Use OS PID checks and the event/stderr files to monitor because the prior coordinator's internal background-process handle is not available in this fresh Hermes process. Do not send input to or kill a healthy worker. Wait for PIDs 2711534/2711554 to exit and for the stream to settle, then parse the structured final result/session/model usage and independently verify every claimed file/test/evidence artifact.

## Frozen routing

- Builder and implementation repairs from now on: canonical Opus 5, exactly `--model opus --effort medium`, through `bash /home/claw/.hermes/skills/autonomous-ai-agents/multi-model-orchestration/scripts/run-claude-no-telegram.sh`, explicit Flow Next plugin, no user settings/hooks/channels.
- Independent reviewer: Sol, `/home/claw/.npm-global/bin/codex`, model `gpt-5.6-sol`, prompt argument with stdin closed.
- No Grok. No silent substitution. One writer per checkout.

## Lifecycle after adoption

1. Verify the adopted Opus transaction's model/effort/result, diff, task-.6 receipt, and all exact gates. If it ends at a turn boundary or leaves ordinary failures, resume the exact Claude session or launch a delta-only Opus 5 medium continuation after confirming the adopted process exited. Continue until task `.6` is genuinely implementation-complete.
2. Run independent Sol task-.6 implementation review. Every `NEEDS_WORK` finding returns to Opus 5 medium; re-review serially until Sol `SHIP`. Architecture changes return to Opus plan repair and Sol plan review first.
3. Only after task `.6` Sol `SHIP`, formally accept/complete `.6` and activate `.7`.
4. Opus 5 medium implements `.7`; verify tests; Sol reviews; repair/re-review until `SHIP`.
5. Run independent spec-completion-review; repair/re-review until `SHIP`.
6. Run all approved integrated browser/security/performance/package/full-suite QA gates and preserve exact evidence.
7. Only after all gates pass: coherent local commits, push `feat/native-pdf-renderer`, open authorized PR, verify URL/readback/CI. Never merge.

## Current formal truth

- Plan `SHIP`, `ready=true`; targeted task-.6 progressive plan repair Sol `SHIP` round 2.
- Tasks `.1`–`.5` accepted with existing Sol `SHIP` receipts.
- Task `.6` in progress, unaccepted, no implementation-review verdict.
- Task `.7` todo.
- Completion review not run.
- HEAD before fn-112 work: `bb994b580356a41a31093fea85b06993c1a18e4c`; current work uncommitted.
- No push/PR/merge.

Follow repository instructions and the full mission in `.flow/reviews/fn-112-full-hermes-resume-opus5-builder.md`. Ordinary test failures, `NEEDS_WORK`, context/turn ceilings and coordinator boundaries are continuation points. Stop only for genuine auth/quota/nonrecoverable environment/safety blockers. Preserve Flow status, reviewer verdict, implementation phase, tests and acceptance as separate facts.