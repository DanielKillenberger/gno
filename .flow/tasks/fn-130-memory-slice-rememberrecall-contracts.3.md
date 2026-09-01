---
satisfies: [R1, R4, R5, R7]
---
# fn-130-memory-slice-rememberrecall-contracts.3 MCP surface: gno_recall + gno_remember

## Description
MCP surface. **Size:** M. **Files/Touches:** src/mcp/tools/memory-recall.ts + memory-remember.ts, src/mcp registry, spec/mcp.md, docs/MCP.md, test/mcp/memory*.
`gno_recall` in the read registry; `gno_remember` gated by --enable-write. Adapters delegate to the core service and DO NOT take ctx.writeLockPath (core owns the lease — see task 1 contract). Recall/remember inputs carry caller+session identity per the core contract (MCP session identity mapped from server session). Tool descriptions written as when-to-call micro-instructions meeting the site copy rules. NOTE dependency direction: fn-131 lands after this spec and adds gno_recall to its core profile; this task ships the tools into today's full registry only.

**Touches:** src/mcp/tools/memory-recall.ts (new), src/mcp/tools/memory-remember.ts (new), src/mcp registry, spec/mcp.md, docs/MCP.md, test/mcp/memory*

## Acceptance
- [ ] gno_recall listed without write flag; gno_remember only with --enable-write (live MCP client listing)
- [ ] Live MCP loop: remember(add) → recall returns the fact with cite + receipt; fence rejects replay via MCP
- [ ] No writeLockPath acquisition in the memory tools (code assertion/test); concurrent MCP remember + CLI writer serialise via core lease
- [ ] Descriptions pass the copy rules; spec/mcp.md updated in the same change

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
