## Goal & Context

Replace calendar-time human dogfooding as the gate between the memory slice (fn-130) and the harness adapters with an automated eval suite: if the memory contracts pass defined thresholds on scripted workloads, adapter work proceeds. Uses the repo's existing Evalite v1 setup (evals/, local-only, opt-in, temp DB per run — per repo eval conventions; no CI integration).

## What

A `memory.eval.ts` suite (plus fixtures) exercising the fn-130 contracts end-to-end through the real CLI/SDK paths against a temp index:

1. **Upsert correctness:** scripted fact streams containing exact duplicates (expect idempotent return of the existing record), near-duplicates/paraphrases (expect candidate proposal + no write without a decision), and clean adds. Metric: decision-behavior accuracy per case class.
2. **Supersession current-state accuracy:** chains of supersedes (including a conflict case: two writers superseding one predecessor — expect exactly one current branch + one conflict) ; recall must return only current facts. Metric: current-state precision = 1.0 required on the fixture; conflict handling asserted.
3. **Recall quality under budget:** seeded memory corpus + query set with relevance judgments; recall@k and precision@k within the 8-fact/512-token budget; every returned fact carries a resolvable gno:// URI. Metrics: recall@5, cite-validity = 1.0, payload ≤ budget always.
4. **Fencing:** loop test at eval scale — recall then attempt remember of receipted spans across N cases; expect 100% rejection of exact replays; document (not assert) paraphrase leak-through rate as an observability number.
5. **Scope isolation:** multi-scope corpus; recall/remember in scope A must never return/write scope B content. Metric: leakage = 0 required.
6. **Session-loop simulation:** a scripted multi-turn "agent day" (mix of recalls, adds, updates, contradictions) driven through the SDK; end-state file tree and recall answers compared against a golden expectation. This is the dogfood-in-a-box.
7. **Latency envelope:** recall fast path timed; threshold documented (target: recall p95 under the fast-query envelope on the eval corpus).

Thresholds live in the eval file as the **adapter gate**: fn-135 starts when the suite is green at the documented thresholds. Failures below threshold file findings back into fn-130 follow-up rather than blocking silently.

## Constraints

- Follows evals/ conventions: opt-in commands (`bun run eval:memory`), temp DB, no network, LLM-judge unused (all checks deterministic — memory contracts are deterministic by design, which is the point).
- Fixtures are committed and content-hashed; the suite is deterministic run-to-run.
- No production data; synthetic fact corpora only.

## Acceptance Criteria

- R1: `bun run eval:memory` runs the seven suites against a temp index and reports per-suite metrics; deterministic across two consecutive runs.
- R2: Required-exact metrics (current-state precision, cite validity, scope leakage, exact-replay fence) assert at 1.0/0; graded metrics (recall@5, latency p95) assert at documented thresholds recorded in the eval file.
- R3: The session-loop simulation produces the golden end-state; divergences render as readable diffs.
- R4: The gate contract is documented (evals section of CLAUDE.md + docs note): what green means for fn-135, and where sub-threshold findings get filed.
- R5: Fixture format documented well enough that new memory scenarios are one fixture file away.

## Boundaries

- Out: CI integration (repo convention: evals are local-only).
- Out: LLM-as-judge anywhere.
- Out: benchmarking against external suites (LongMemEval-class run is a separate credibility item).
- Out: evaluating harness adapters themselves (fn-135 carries its own verification).

## Pilot routing

no-plan (one eval suite plus fixtures; dispatch work with --no-plan).
