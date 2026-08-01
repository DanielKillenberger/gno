# Durable Hermes continuation — fn-112 after gateway shutdown

You are the sole workflow owner for `/home/claw/work/gno-pdf-renderer`, branch `feat/native-pdf-renderer`, Flow spec `fn-112-native-pdfjs-document-renderer`.

The prior full Hermes process was terminated by a gateway shutdown. No Grok, Sol, Opus, Claude, Codex, or other Hermes writer is active in this checkout now. Resume from repository truth; do not restart completed work.

## Verified checkpoint

- Plan status: `ship`; `ready=true`.
- Task `.1`: accepted, Sol implementation review `SHIP` round 4.
- Task `.2`: accepted, Sol implementation review `SHIP` round 3.
- Task `.3`: accepted, Sol implementation review `SHIP` round 5.
- Task `.4`: accepted, Sol implementation review `SHIP` round 3.
- Task `.5`: accepted, Sol implementation review `SHIP` round 2; B5-01/B5-02/B5-03 resolved.
- Task `.6`: `in_progress`; inspect and preserve all partial implementation and receipts.
- Task `.7`: `todo`.
- Completion review: unknown.
- No push, PR, or merge has been verified.

## Required routes

- Implementation: authenticated canonical Grok 4.5 only.
- Independent task/completion review: Sol via `/home/claw/.npm-global/bin/codex`, model `gpt-5.6-sol`, ChatGPT auth, prompt argument with stdin closed.
- Architectural plan changes only: canonical Opus 5 at exactly `--model opus --effort medium` through `/home/claw/.hermes/skills/autonomous-ai-agents/multi-model-orchestration/scripts/run-claude-no-telegram.sh` with explicit Flow-Next and frontend-design plugins as needed.
- No silent model substitution.
- One writer at a time; external model calls serial.

## Lifecycle

1. Read `AGENTS.md`, `CLAUDE.md`, Flow spec/tasks, all task `.6` implementation/review receipts, event logs, and current git status/diff.
2. Determine exactly which task `.6` acceptance items are implemented versus pending. Continue with Grok from repository truth.
3. Run task-level checks, independent Sol implementation review, Grok repairs, and re-review until task `.6` receives `SHIP`; ordinary `NEEDS_WORK` is a continuation point.
4. Activate and complete task `.7` through the same implement/check/review/fix/SHIP sequence.
5. Run independent `spec-completion-review`; repair and re-review until `SHIP` unless a genuine auth/quota/nonrecoverable blocker exists.
6. Run all required integrated gates from the approved plan: formatting/lint, TypeScript, full tests, test:web, docs verification, package/build smoke, real browser QA, accessibility, security fixtures, and repeatable first-page/large-PDF performance evidence. Do not excuse product failures as environmental without proving they occur before relevant assertions.
7. Preserve exact receipts, commands, outputs, model/session identity, findings and dispositions at each phase boundary.
8. After every gate passes, create coherent local commits, push `feat/native-pdf-renderer`, and open the authorized PR. Verify URL/readback/CI. Do not merge.

## Constraints

- Native direct PDF.js inside existing `/doc`; no iframe/object/embed/CDN.
- Do not modify `/tmp/gno-native-pdf-investigation`, Daniel-OS, GNO collections, Threshold, or unrelated repositories.
- Do not rely on bounded delegation for the lifecycle; supervise external CLIs as durable processes.
- Do not stop on model turn ceilings: resume the exact session or launch a tightly scoped continuation.
- Keep Flow metadata truthful: review verdict, implementation completion, accepted/SHIP, and next-task activation are separate states.
- The owner wants concrete milestone updates naming review round, resolved/open findings, tests and formal transitions; receipts must support that reporting.

Continue autonomously until verified PR creation or a genuine blocker. Return a concise final report with task verdicts, integrated gate results, commit(s), pushed branch, PR URL and any remaining blocker. Never merge.