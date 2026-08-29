---
satisfies: [R10]
---
# fn-120-gno-recall-omarchy-shell-plugin.8 Browse collections from overlay and panel

## Description
Implement collection browsing (R10) across the shared service and both popup surfaces: list all collections, drill into one with paginated documents, open browsed docs, fully keyboard-driven.

**Size:** M
**Files:** Service.qml; RecallOverlay.qml; Panel.qml; README.md
**Touches:** Service.qml; RecallOverlay.qml; Panel.qml; README.md

### Approach
- Service.qml gains two new gno subprocess paths, both following the established R7/R9 rules (argv arrays, generation IDs with late-drop, kill timers, stdout bounds checked incrementally, memory-only caching):
  - `gno status --json` → collections[] {name, path, documentCount} (cache with age; refresh on browse-mode entry; bound with maxPeekStdoutChars-class constant)
  - `gno ls <collection> --json -n <pageSize> --offset <n>` → documents[] {docid, uri, title, source.relPath} (named pageSize constant, e.g. 50; meta for has-more if present, else infer from page fill)
- absPath derivation for browsed rows: collection.path + "/" + URI-decoded source.relPath (decodeURIComponent on the relPath segments). This is the documented consumer-side join; verify against a real doc with spaces/umlauts in the name.
- Overlay browse mode: from the recents view a documented key (follow studied Omarchy plugin conventions) switches to the collections list (name + doc count); Enter drills into a collection (paginated doc list, more-pages keyboard affordance); Enter on a doc opens it (R5 open pipeline); Esc/Backspace navigates back one level before the final Esc dismisses. In-memory filter keeps working within each browse level (zero subprocess per keystroke).
- Panel entry point: a "Browse collections" action that summons the overlay directly into collections mode (extend overlay open(payload) to accept a mode hint).
- Errors: status/ls failure or timeout → inline error, browse stays interactive; empty collection → explicit copy; oversized/malformed ls output → bounded rejection, no crash.
- Live-install and drive every path with captured evidence.

### Key context
Verified against installed released gno 1.36.0: `gno status --json` returns collections[] with name/path/documentCount; `gno ls <name> --json` returns uri + source.relPath but NO absPath — the join derivation above is required for file-open. Do not call gno get. Respect the existing overlay Esc semantics (clear filter → back a level → dismiss).

## Acceptance
- [ ] Overlay browse mode lists all collections (name + document count) from `gno status --json` and drills into a paginated `gno ls <collection> --json` document list, keyboard-only (Enter in, Esc/Backspace back, paging affordance).
- [ ] Browsed doc rows open via the R5 pipeline using absPath joined from collection path + URI-decoded relPath; verified live on a doc whose name contains spaces.
- [ ] Panel offers a browse entry point that summons the overlay in collections mode.
- [ ] Both new subprocesses use argv arrays, generation IDs, timeouts, and incremental stdout bounds; status/ls failure, empty collection, and oversized output are explicit inline states that never crash the shell.
- [ ] Installed from the local checkout onto the live Omarchy session; evidence captured for collections list, drill-in with pagination, open-from-browse, empty collection, and ls failure.


## Done summary
Collection browsing shipped (R10). Service: runStatus() (gno status --json; generation, 8s kill timer, incremental 512KiB bound, memory-only collections cache with lastStatusAt) and runLs(collection, offset) (gno ls <name> --json -n 50; --offset omitted on page 1 because gno 1.36.0 rejects 0; cancel-inflight + late-drop + 512KiB bound); browsedAbsPath() joins collection.path + / + relPath and feeds the existing open pipeline. Overlay: three levels (recents -> collections -> docs) entered via Tab or Ctrl+B; in-memory filter at every level (proven zero status/ls spawns while typing); Enter drills/opens/loads-more; Load more/Right/PgDn pagination; layered Esc (clear filter -> back a level -> dismiss) plus empty-filter Backspace; header shows location and page; explicit collection-empty and ls-failure inline states that stay interactive. Panel: Browse collections action summoning the overlay with mode=collections payload. Live QA verified in-host: 22 collections listed, ai drill-in paged 50->100 rows (page 2 header), open-from-browse launched a real window for a spaces-in-name doc via the joined absPath, esc-levels journaled, panel entry captured. Gates: validate 0, qmllint 0. Session restored ready/1673. Known P2 carried to .9: browse-row relPath renders twice (metaText + snippet both carry it); same double-render on the Load more row.
## Evidence
- Commits: 058ec9817d6ab969b92da1fa90c31769a920725b
- Tests: omarchy plugin validate ., qmllint -I /usr/share/omarchy/shell, live QA /tmp/fn-120.8-qa (collections/drill-page/open-from-browse/browse-filter/empty/ls-failure/esc-levels/panel-entry)
- PRs: