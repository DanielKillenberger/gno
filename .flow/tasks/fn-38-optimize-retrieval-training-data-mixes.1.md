# fn-38-optimize-retrieval-training-data-mixes.1 Run multilingual-boost dataset experiment

## Description

TBD

## Acceptance

Run the first targeted data-mix experiment using the new mix-variant tooling. Start with the multilingual-boost mix because multilingual retrieval is a known weakness and a likely source of lift.

Acceptance:

- build a variant dataset from the multilingual-boost mix
- launch a real training run against that variant dataset
- record the run config and rationale in the sandbox run history
- verify the run starts cleanly and reaches at least the first validation checkpoint

## Done summary
Blocked:
Stale claim from 2026-03-09. No active Flow run and no implementation, review, or sync evidence. Gordon confirmed no task should currently be in progress.
## Evidence

- Commits:
- Tests:
- PRs:
