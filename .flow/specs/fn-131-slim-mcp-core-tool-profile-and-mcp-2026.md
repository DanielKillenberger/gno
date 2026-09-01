## Goal & Context

Cut the MCP surface cost and close the protocol gap. Today GNO advertises 25 read tools by default (plus 15 write behind the flag) and speaks MCP protocol 2025-11-25. qmd advertises 4 tools and speaks 2026-07-28 — every extra tool definition is context rent an agent pays each session, and the playbook itself already steers agents to a handful of tools. Strategy note gap 2 (vault: GNO Competitive Gap Analysis 2026-09).

## API Contracts

- **Tool profiles:** `gno mcp --tool-profile core|full` (and the equivalent for the resident gateway config). `core` (new default is a DECISION POINT — ship as opt-in first, flip default in a follow-up release note if dogfood confirms) advertises approximately: `gno_query`, `gno_search`, `gno_get`, `gno_multi_get`, `gno_context`, `gno_changes` (+ `gno_recall` once fn-130 lands; `gno_remember` joins the write set). `full` preserves today's surface exactly. Write tools remain gated by `--enable-write` in both profiles. Exact core membership is decided in the spec's task work against the skill playbook's own routing advice; the count target is ≤7 read tools.
- **Protocol dual-speak:** accept and correctly negotiate both MCP 2025-11-25 and 2026-07-28 revisions (handshake/version negotiation, sessionless Streamable HTTP mode where the 2026 revision expects it, discovery affordances). Older clients keep working unchanged; 2026-07-28 clients negotiate natively rather than downgrading.
- Tool descriptions in the core profile are rewritten as micro-instructions under the copy rules (each description answers: when to call this, what comes back) — descriptions are the primary zero-install discovery surface.
- spec/mcp.md documents both profiles, the negotiated protocol revisions, and the exact core tool list.

## Edge Cases & Constraints

- No tool is removed; `full` is byte-compatible with today's registry.
- Existing tests distinguishing read/write sets must keep passing; profile selection adds tests, never weakens the write gate.
- The resident gateway (shared by serve/daemon) honors the profile consistently for every connected client.
- Skill and docs references to tool names must stay accurate for both profiles.

## Acceptance Criteria

- R1: `gno mcp --tool-profile core` advertises the documented core set (≤7 read tools) and nothing else; `--tool-profile full` matches today's surface exactly. Verified live via a real MCP client listing tools in both modes.
- R2: Write tools appear only with `--enable-write`, in both profiles. Verified live.
- R3: A 2026-07-28 client completes the handshake natively (correct negotiated version, sessionless HTTP path working); a 2025-11-25 client is unaffected. Verified live with protocol-version assertions on the wire, both stdio and Streamable HTTP.
- R4: Core-profile tool descriptions pass the copy rules and state when-to-call guidance; skill/playbook routing advice and the descriptions agree.
- R5: spec/mcp.md, docs/MCP.md updated in the same change, including the profile decision and the deferred default-flip note.
- R6: No regression in the full MCP test suite; new tests cover profile selection and version negotiation.

## Boundaries

- Out: changing which tools exist, or any tool's behavior.
- Out: flipping the default profile in this spec (explicit follow-up decision with dogfood evidence).
- Out: MCP subscriptions/change-events (`resources.subscribe`) — that is fn-132's `changes --follow` territory and a possible later MCP mapping.
