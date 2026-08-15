# Cloud-placeholder-safe indexing

## Conversation Evidence

> user (turn 1, part 1): "Could GNO support an option to index/embed only files that are already mirrored/downloaded locally within a Drive File Provider directory, while skipping cloud-only placeholders?"
> user (turn 1, part 2): "I want to point GNO at the full Google Drive directory because that is where nearly all of my working files live. About 95% are already local, but the remaining cloud-only files can trigger Drive downloads and heavy I/O during a scheduled index."
> user (turn 1, part 3): "A mode that detects and skips those files would let me retain broad coverage without turning the indexing job into a sync event."
> user (turn 1, part 4): "Something like --local-only or --skip-cloud-placeholders at the collection or index level would be ideal. Is that feasible with the macOS File Provider APIs?"
> user (turn 1, part 5): "afaict they were indexing/embedding content on a synced (or partially synced) onedrive, google drive type deal, will assume this would also apply to icloud drive stuff."
> user (turn 1, part 6): "i know for a fact he was on a mac, but i guess the question is, can we determine whether content has been downloaded? analyse in depth"
> user (turn 2): "capture this, make sure the first thing to do is to do the smoke testing on macos. i am also worried this would result in a performance loss, is that the case"

## Goal & Context
<!-- scope: business -->
<!-- Source-tag breakdown: 70% [user] / 30% [paraphrase] -->

A macOS GNO user keeps nearly all working files in Google Drive, with most content already local and a minority represented by cloud-only File Provider placeholders. Scheduled indexing currently risks turning that minority into an unintended cloud sync event, causing heavy network and disk I/O. GNO should offer an explicit source-availability mode that indexes content already present locally while refusing to materialize cloud-only content.

The first work must be a physical-macOS smoke study, before production implementation. It must establish actual behavior and performance on File Provider storage rather than accepting API documentation or source inspection as sufficient proof.

## Architecture & Data Models
<!-- scope: technical -->
<!-- Source-tag breakdown: 100% [inferred] -->

Model source availability as a collection/index policy separate from GNO's egress policy. The existing behavior remains the default; an opt-in local-files-only policy activates platform-aware discovery and guarded source reads.

The ingestion boundary needs one availability abstraction that can classify a source as local, dataless, or unknown and can prevent source materialization while local-files-only work runs. On macOS, the implementation should use supported filesystem materialization state and a fail-closed no-materialization I/O policy. A classification check alone is insufficient because availability can change between discovery and reading and providers may support partially materialized content.

Traversal must inspect directory availability before descending. Results must distinguish eligible files, cloud-only files, and skipped dataless directory prefixes so reconciliation can preserve previously indexed documents whose current source cannot safely be enumerated.

Full scans, targeted incremental sync, and watch-triggered sync must pass through the same availability enforcement. No ingestion path may bypass the guarded read boundary.

## API Contracts
<!-- scope: technical -->

- Collection/index configuration exposes an opt-in source-availability choice with `any` and `local` semantics. [inferred]
- CLI naming must avoid `--local-only`, which can be confused with GNO's existing local-only egress boundary; use language specific to local source files or cloud placeholders. [inferred]
- `any` preserves current discovery and ingestion behavior. `local` accepts materialized content and skips reads that would require materialization. [paraphrase]
- Local-files-only receipts distinguish cloud-only skips from errors and report skipped files and dataless directory prefixes. [inferred]
- A guarded read that encounters unavailable content resolves as a cloud-placeholder skip, not a conversion failure. [inferred]

## Edge Cases & Constraints
<!-- scope: technical -->

- Availability is rechecked at the content-read boundary; a discovery-time result is not trusted across an eviction or provider-state race. [inferred]
- A dataless directory is not enumerated. Existing indexed descendants under that prefix remain active because absence was not proven. [inferred]
- A previously indexed file that is later evicted retains its last indexed content and is reported as unavailable for refresh; a never-indexed placeholder gains no document until it becomes local. [inferred]
- Partial-content providers must not be able to download missing ranges during sniffing, hashing, conversion, record import, or watcher-driven ingestion. [inferred]
- Unsupported platforms or filesystems must not claim a zero-download guarantee. Initial product scope is macOS File Provider storage; broader support requires independent platform evidence. [paraphrase]
- Metadata/provider bookkeeping may still occur. The guarantee is that GNO does not download file contents in local-files-only mode, not that provider processes perform zero work. [inferred]
- Performance measurements separate traversal/scan time from hashing, conversion, and embedding time so ingestion cost cannot hide a traversal regression. [inferred]

## Acceptance Criteria
<!-- scope: both -->

- **R1:** Before production implementation begins, a physical-macOS smoke study exercises local, pinned/offline, cached-but-unpinned, cloud-only, nested dataless-directory, and state-race cases; proves cloud-only reads fail without changing Finder/provider availability state; records timing; and verifies Google Drive and iCloud Drive, plus OneDrive before OneDrive support is claimed. [paraphrase]
- **R2:** A user can opt a collection or index run into local-files-only source handling and index the locally materialized portion of a File Provider tree without downloading cloud-only file contents. [paraphrase]
- **R3:** Local-files-only traversal does not materialize dataless directories, and every content-reading ingestion path is protected against materialization races or partial-content fetches. [inferred]
- **R4:** Cloud-only sources have a distinct skipped outcome; previously indexed sources remain searchable when later evicted, while never-indexed placeholders remain absent until local. [inferred]
- **R5:** Full indexing, targeted sync, scheduled indexing, and watch-triggered ingestion enforce identical source-availability semantics. [inferred]
- **R6:** On the macOS smoke benchmark, the existing default mode regresses by no more than 3% median scan time and local-files-only mode adds no more than 10% median scan time on an all-local corpus, using repeated runs and reporting corpus shape and variance. [inferred]
- **R7:** Documentation and receipts state the macOS guarantee, provider evidence, stale-index behavior after eviction, performance findings, and the distinction between source availability and egress policy. [inferred]

## Boundaries
<!-- scope: business -->

- The first implementation target is macOS File Provider-backed storage, specifically the reported Google Drive case and expected iCloud Drive and OneDrive cases. [paraphrase]
- Provider-specific Google Drive, OneDrive, or iCloud SDK integrations are out of scope unless the smoke study disproves the provider-neutral filesystem approach. [inferred]
- Windows Cloud Files and Linux/FUSE placeholder support are out of scope for this spec. [inferred]
- Local-files-only mode does not evict, pin, download, or otherwise change provider availability state. [inferred]
- This feature does not redefine GNO's egress/privacy policy. [inferred]

## Decision Context
<!-- scope: both — conditionally substructured -->

### Motivation
<!-- scope: business -->

- Broad collection coverage matters more than forcing a fully mirrored Drive, but scheduled indexing must not become an implicit sync job. [paraphrase]
- macOS smoke evidence comes first because correctness and performance depend on real File Provider behavior. [user]
- Avoiding a meaningful indexing slowdown is part of the feature outcome, not a later optimization. [paraphrase]

## Strategy Alignment

- The feature strengthens the local knowledge lifecycle by making ingestion dependable across cloud-backed local sources. [strategy:Local knowledge lifecycle]
- Refusing hidden materialization reinforces the local-first approach and its requirement that network boundaries remain explicit. [strategy:Controlled portability]
- Shared enforcement across full, scheduled, and watch ingestion supports coherent behavior across GNO surfaces. [strategy:Coherent agent and application surfaces]

## Strategy Conflicts

None identified.

## Requirement coverage

| Requirement | Planned task |
| --- | --- |
| R1 | TBD — populate via `/flow-next:plan` |
| R2 | TBD — populate via `/flow-next:plan` |
| R3 | TBD — populate via `/flow-next:plan` |
| R4 | TBD — populate via `/flow-next:plan` |
| R5 | TBD — populate via `/flow-next:plan` |
| R6 | TBD — populate via `/flow-next:plan` |
| R7 | TBD — populate via `/flow-next:plan` |
