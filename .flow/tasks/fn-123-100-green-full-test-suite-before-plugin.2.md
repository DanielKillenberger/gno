# fn-123-100-green-full-test-suite-before-plugin.2 Fix 3 Ubuntu-CI-only DOM test failures exposed by pipefail

## Description
TagFacets, AIModelSelector (1s waitFor timeouts), FrontmatterDisplay (instant query miss) fail in full-suite runs on ubuntu-latest only; pass locally isolated and in local full suite. Previously hidden by bun test | cat without pipefail.

## Acceptance
CI test (ubuntu-latest) job green with pipefail active; tests unchanged semantically (timeouts/isolation hardening ok); no unconditional skips.

## Done summary
Fixed the three Ubuntu-CI-only DOM test failures exposed by the pipefail
fix. Root cause: Bun mock.module stubs are process-global and Ubuntu walks
pages/ test files before components/, so Search.dom and DocView.dom page
tests left component stubs (TagFacets, AIModelSelector,
FrontmatterDisplay) installed when the real component suites ran. Fix
follows the PdfViewer precedent: page tests now mock dedicated page-only
re-export modules (src/serve/public/pages/search-page-widgets.tsx,
doc-frontmatter-display.tsx); real component modules are never stubbed.

Worker proved the mechanism locally by forcing the CI discovery order
(repro + elimination). Host-reviewed diff (pure re-exports + import
swaps), pushed, and CI run 33314335456 completed fully green with
pipefail active - first honest all-green CI on this repo.

Evidence: /tmp/fn-123.2-qa/ (analysis.md, repro-before-fix.log,
isolated.log, full-local.log 4395 pass/0 fail, taskset single-core run
0 fail, lint.log).
## Evidence
- Commits: c44694c6
- Tests: bun test (local full suite 4395 pass / 0 fail), CI run 33314335456 all jobs green with pipefail
- PRs: