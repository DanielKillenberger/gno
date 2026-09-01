---
satisfies: [R1, R2, R3, R4, R5]
---
# fn-133-site-and-docs-memory-positioning-agents.4 Copy-rule pass, gates, deploy, prod QA

## Description
Copy-rule pass, gates, deploy, prod QA. **Size:** S. **Files/Touches:** scripts/smoke-web.ts assertions if headlines changed; deploy execution only otherwise.
Anti-slop copy review over all changed pages (findings addressed or explicitly accepted, recorded in the PR); bun run check/typecheck/build + content tests; drive changed pages on :3344; deploy from heimdall; verify the same pages live on https://gno.sh with captured evidence per the site QA gate.

**Touches:** gno.sh: scripts/smoke-web.ts (assertions), deploy execution

## Acceptance
- [ ] Copy-review findings recorded with dispositions
- [ ] Site gates green; changed pages driven locally AND on prod with evidence (URLs + assertions)
- [ ] Deploy verified: remote HEAD matches origin/main, service active

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
