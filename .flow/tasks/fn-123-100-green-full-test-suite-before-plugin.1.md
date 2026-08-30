# fn-123-100-green-full-test-suite-before-plugin.1 Fix six known bun test failures (4 clusters), suite 100% green

## Description
Root-cause and fix: macos-file-provider-smoke x3 (env-sensitive, fails locally not CI), SPA bundle 500 (full-suite interference), clipper package flake (full-suite interference), agentic baseline provenance (dirty-tree). Prefer test isolation fixes; conditional reasoned skips only as last resort.

## Acceptance
Two consecutive clean-tree full bun test runs 0 fail; one dirty-tree full run 0 fail; each test passes isolated; lint:check green; no .only or unconditional .skip.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
