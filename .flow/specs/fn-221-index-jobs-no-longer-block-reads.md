# Index jobs no longer block reads

## Conversation Evidence

> user (turn 1, [paraphrase]): "How does GNO's indexing work today, and what would have to happen if around 100 people on one shared deployment asked to reindex parts at the same time? Would a queueing system make sense without degrading the experience for single-user vaults?"

## Goal & Context
<!-- scope: business -->
<!-- Source: 20% user / 30% [paraphrase] / 50% [inferred] -->

A running index, sync or embed job holds the per-process MCP tool mutex for its whole run. In stdio MCP, every `gno_search`, `gno_query` and `gno_get` waits behind a full index or embed. In `gno serve` / `gno daemon` the same mutex is shared with the HTTP `/mcp` endpoint, so one REST `/api/sync` or Web UI save stalls every connected agent.

This hurts single-user vaults today (an agent's search stalls while the vault reindexes) and becomes the dominant latency problem when one resident serves many callers, e.g. around 100 people where some of them ask to reindex at the same time. Fixing it is the first step towards handling concurrent reindex requests, and it stands on its own.

## Architecture & Data Models
<!-- scope: technical -->
<!-- Source: [inferred] -->

- Long-running write jobs stop holding the tool mutex for their duration. The mutex keeps serialising short tool calls only where that is still needed.
- Exclusion between writers stays where it is today: the shared write lease across processes, `BEGIN IMMEDIATE` within SQLite, and the job manager's one-active-job rule. WAL mode already lets readers proceed while a write transaction is open.
- Reads see the last committed state; a reindex that is half-way through shows the batches it has already committed.

## Edge Cases & Constraints
<!-- scope: technical -->
<!-- Source: [inferred] -->

- Reads must not join a write job's open transaction on a shared connection; they need their own connection or must run outside any open transaction.
- Write tools that are not jobs (capture, remember, rename, move) keep whatever serialisation they rely on today.
- No change to job-manager rejection behaviour (`JOB_CONFLICT` / `LOCKED`); that belongs to the sibling queue spec.

## Acceptance Criteria
<!-- scope: both -->

- **R1:** While an index, sync or embed job is running in a process, read tools (search, query, vsearch, get, multi-get, status) served by that process complete without waiting for the job to finish, both over stdio MCP and over the resident's HTTP `/mcp`. Errors: no error surface beyond today's read errors; a read issued during a write sees the last committed state. [inferred]
- **R2:** Single-user vaults are not degraded: with a single caller, index, sync and embed jobs produce the same index contents and the CLI keeps its current write-lease wait, `--no-wait` behaviour and exit codes. Errors: no error surface beyond today's. [paraphrase]

## Boundaries
<!-- scope: business -->

- No job queue, request merging or path-level reindex here; those are in the sibling spec "Queued, coalesced, path-level reindexing". [inferred]
- No change to the single-writer model or the write lease. [inferred]

## Decision Context
<!-- scope: both -->
<!-- Source: [inferred] -->

Split out from one captured spec on concurrent reindexing (the sibling is "Queued, coalesced, path-level reindexing", which depends on this one). This part ships first because it helps single-user vaults immediately and needs no decision on whether GNO should have a job queue, which `fn-127` rejected.
