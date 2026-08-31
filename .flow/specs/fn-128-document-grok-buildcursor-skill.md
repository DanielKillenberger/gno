## Why

The gno.sh site now states (verified against Cursor docs and x.ai Grok Build docs, 2026-09-01) that Grok Build and Cursor read the Claude skill directory automatically, so `gno skill install --target claude` covers them. GNO's own docs and skill installer do not say this anywhere, and `gno skill install --help` lists only claude, codex, opencode, openclaw, hermes, all.

## What

1. Document the compatibility in docs/CLI.md (skill install section), assets/skill README if present, and spec/cli.md: the claude target serves Grok Build and Cursor via their automatic .claude/skills discovery; any other skill-capable client can copy the files from `gno skill paths`.
2. Evaluate (decide, not necessarily build) explicit `grok` and `cursor` installer targets: likely thin aliases for the claude path or copies into ~/.grok/skills and ~/.cursor/skills for users who keep those separate. If aliases are added, update the autoresearch skill eval per CLAUDE.md.

## Acceptance

- R1: docs/CLI.md and spec/cli.md name the Grok Build / Cursor compatibility with the claude target, with the manual-copy fallback (`gno skill paths`).
- R2: A written decision (in the spec or docs) on whether explicit grok/cursor targets ship, with rationale.
