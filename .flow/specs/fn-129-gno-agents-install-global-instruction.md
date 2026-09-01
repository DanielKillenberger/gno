## Why

Agents only use GNO well when the operator hand-authors usage instructions into harness files, and those hand-pasted blocks rot (same failure mode as the hand-submitted OpenClaw plugin). The strategy decision (vault: GNO Competitive Gap Analysis 2026-09) picked global instruction files as the primary discovery channel: user-scope CLAUDE.md reaches Claude Code, Grok Build, and Cursor; user-scope AGENTS.md reaches Codex, OpenClaw, and other AGENTS.md-reading harnesses. Per-turn hook recall was explicitly rejected (chat-assistant pattern, noise on coding turns); instructions leverage model judgment about WHEN to retrieve.

## What

`gno agents install` — a first-class installer for a marker-bounded GNO instruction block in harness instruction files.

- Targets: `claude` (user-scope CLAUDE.md), `agents` (user-scope AGENTS.md), `all`, plus dedicated targets for any harness whose global instruction file is NOT one of those two. Task includes building a verified per-harness coverage matrix before finalizing the target list: confirm whether Grok Build reads the user-global CLAUDE.md (it verifiably reads project CLAUDE.md and .claude/ dirs), what Cursor's user-level instruction surface is (rules system vs its AGENTS.md support), and Codex/OpenClaw/Hermes global file locations. Add `grok` / `cursor` targets only where the two default files demonstrably do not reach them. Project scope via `--scope project` writes to ./CLAUDE.md / ./AGENTS.md. Default `--scope user` — the whole point is fleet-wide leverage.
- Block: BEGIN/END markers with a version stamp, idempotent install, `gno agents update` refreshes in place, `gno agents uninstall` removes cleanly, never touches content outside the markers. `--dry-run` prints the diff.
- Block content v1 — the LADDER plus the write path (memory rungs added when the memory slice ships): what GNO is (one local index); ladder-based retrieval — `gno search` for exact terms/identifiers, `gno query` for hybrid/conceptual, escalate to `gno context build` when a goal needs compiled evidence, `gno ask --verify` when an answer must be checked, and reformulate-and-retry on a miss instead of giving up; writing/storing TODAY via `gno capture` with provenance (`--source-kind`) and presets; citation discipline (gno:// URIs); collections/tags filters exist; pointer to `gno skill install` for slash-command clients. Tight — the block competes for context in every session; target well under 1,500 characters.
- JSON output for scripting; respects the repo's plain-text/markdown conventions of each target file.
- Follow the write pattern of `gno skill install` (atomic temp+rename where applicable, receipts in output).

Design input, non-blocking: Gordon's personal tailored instruction setup (separate effort, in progress; notes incoming as reference — it goes further than the product version, e.g. tailored ladders) will be mined for ideas post-landing; this spec ships the general-audience version and must not wait for it.

## Acceptance

- R1: `gno agents install --target all` creates or updates the marker block in every location the verified harness matrix requires; a second run is a no-op (idempotent); content outside markers is byte-identical before/after. The matrix itself (which harness reads which file, with evidence) lands in docs.
- R2: `gno agents update` replaces only the block; `gno agents uninstall` removes block and markers; both exit non-zero with a clear message if markers are missing/corrupted.
- R3: `--scope project` writes ./CLAUDE.md / ./AGENTS.md with the same semantics.
- R4: `--dry-run` prints a unified diff and writes nothing.
- R5: Block content is versioned; `update` from an older block version succeeds; block length stays under the documented budget.
- R6: Docs updated in the same change (docs/CLI.md, spec/cli.md; site follows post-merge per downstream rules); all four-surface rule does not apply (this is a CLI-only operator command by nature — recorded as a deliberate exception).
