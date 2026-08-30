## Why

PR #200 (fn-124, external contribution from DanielKillenberger) changes user-facing serve behavior: default `gno serve` is the production bundle, `--dev` is the HMR switch, and docs/WEB-UI.md documents first-page-load bars (P95 first paint of home chrome <= 200ms, P95 TTI <= 1s, localhost production cold-cache harness). The hosted website repo (`~/work/gno.sh`, private) could not be updated by the contributor and must be reconciled after the PR merges.

## What

After PR #200 lands on main:

1. Update gno.sh docs/reference pages for the serve default, `--dev`, and the snapshot refresh command (`bun run build:spa`).
2. Decide whether the first-page-load bars belong on the site (performance/FAQ/comparison surface); add if yes.
3. Run the Live QA gate for the site per repo CLAUDE.md: drive changed pages locally (bun run dev, port 3344), then deploy and re-verify on https://gno.sh.

## Acceptance

- R1: gno.sh serve/CLI reference matches spec/cli.md after the merge (default production, --dev, --status/--stop unaffected, detach inheritance).
- R2: Changed pages driven locally and on production with captured evidence, per the Live QA gate.
