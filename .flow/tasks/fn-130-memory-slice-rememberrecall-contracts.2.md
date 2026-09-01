---
satisfies: [R1, R4, R5]
---
# fn-130-memory-slice-rememberrecall-contracts.2 CLI surface: gno remember / gno recall

## Description
CLI surface. **Size:** M. **Files/Touches:** src/cli/program.ts, new src/cli/commands/memory.ts, spec/cli.md, docs/CLI.md, test/cli/memory*.
`gno remember` / `gno recall`: explicit `--scope` (repeatable, fail-closed — missing scope exits VALIDATION), `--collection`, decision flags `--add` / `--supersede <uri> --predecessor-hash <hash>` (neither → candidate-proposal output), `--budget` overrides on recall, required caller/session identity flags (defaulted from process context, overridable), `--json` everywhere; self-teaching empty-recall line names `gno remember`; exit codes per spec/cli.md conventions (VALIDATION for scope/flag errors, dedicated conflict signaling for supersede races per core contract). Calls the core service ONLY — no direct store access, no lease acquisition (core owns it).

**Touches:** src/cli/program.ts, src/cli/commands/memory.ts (new), spec/cli.md, docs/CLI.md, test/cli/memory*

## Acceptance
- [ ] Missing --scope exits VALIDATION with a message naming the flag, live-verified
- [ ] add / supersede / no-decision flows live-verified end to end incl. candidate-proposal output shape
- [ ] Empty recall prints the self-teaching line; populated recall shows cites + budget respected
- [ ] spec/cli.md + docs/CLI.md sections land in the same change; --json shapes match the shared schema

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
