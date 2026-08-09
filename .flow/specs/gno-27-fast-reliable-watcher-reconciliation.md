# Fast, reliable watcher reconciliation

## Conversation Evidence

> user (turn 1, part 1): "great, now check:"
> user (turn 1, part 2): "[gmickel/gno#183](https://github.com/gmickel/gno/pull/183)"
> user (turn 1, part 3): "what can we do with this? it's older so probably some drift from the things we'lve landed"
> user (turn 1, part 4): "good PR, good fix? any unintended consequences? can it be brought forward"
> user (turn 2): "so do you think worth it though or will this lead to perf probloems for all"
> user (turn 3): "ok, plan this work, we need to get the perf thing fixed first, and you would create your own PR you said, right, get started"
> user (turn 4, part 1): "i just reinstalled flow-next, we should have an even newer version, check and run [$flow-next-setup](/Users/gordon/.codex/skills/flow-next-setup/SKILL.md)"
> user (turn 4, part 2): "but after that is done, i do not want a spec for this work yet, i want to do all the testing we need to be able to write the spec later"
> user (turn 5): "ok, 1"
> user (turn 6): "can you do the probe thing now as the last evidence we need before capturing the spec"
> user (turn 7): "[$flow-next-capture](/Users/gordon/.codex/skills/flow-next-capture/SKILL.md) we have all the evidence to implement this quickly and efficiently"

## Goal & Context
<!-- scope: business -->
<!-- Source-tag breakdown: 35% [user] / 55% [paraphrase] / 10% [strategy:Local knowledge lifecycle] -->

Continuous indexing can silently miss atomic saves when the filesystem watcher
reports only an ineligible temporary filename. Partial recursive-delete events
can likewise leave deleted documents retrievable until a manual update. PR #183
demonstrated the correctness problem and a viable reconciliation direction, but
its branch has drifted and its ambiguous-event path can submit every unchanged
sibling to the expensive synchronization pipeline.

The measured current-main cost is about 15 seconds for 5,000 unchanged files.
The validated direction preserves content-safe hashing while reducing candidate
discovery to milliseconds on macOS/Linux and under 500 ms on Windows. The goal
is a fresh maintainer implementation that brings forward the contributor's core
fix without importing the stale branch or imposing that full-directory cost on
normal watcher activity.

## Architecture & Data Models
<!-- scope: technical -->
<!-- Source-tag breakdown: 10% [user] / 90% [paraphrase] -->

The watcher owns an in-memory, per-collection hierarchical snapshot indexed by
directory. Each no-follow entry fingerprint contains file kind, device, inode,
size, nanosecond modification time, and nanosecond change time. Fingerprints
select candidates only; they never prove that indexed content is unchanged.

Exact eligible watcher paths retain the existing targeted synchronization path
and therefore the existing full content-hash decision. Ineligible, missing, or
otherwise ambiguous events mark a directory dirty. A flush compares that
directory's direct children with the prior snapshot, recurses only into changed
or new directories, and expands removed directories from the prior snapshot.
When a reported path vanished, reconciliation climbs to the nearest surviving
ancestor before diffing so incompletely reported subtree deletions cannot miss
siblings.

Candidates from exact events and snapshot reconciliation are deduplicated into
one targeted synchronization batch. The snapshot advances only after successful
classification. Initialization races, snapshot limits, unreliable metadata, or
scan failures use a bounded disk/index reconciliation fallback based on active
direct children and descendants; failure never implies deletion.

## API Contracts
<!-- scope: technical -->
<!-- Source-tag breakdown: 100% [paraphrase] -->

The public CLI, REST, status, and output schemas remain unchanged. `gno serve`
and `gno daemon` gain reliable continuous-index behavior through their shared
resident watcher.

The internal event contract distinguishes two paths:

- an exact eligible source path must reach content-safe targeted synchronization;
- an ambiguous event is only a hint about an affected directory and must be
  classified before candidate paths reach synchronization.

The fallback store contract returns active indexed source paths for bounded
direct-child and descendant queries. Store errors are explicit failures; an
empty answer is actionable only after a successful query.

## Edge Cases & Constraints
<!-- scope: technical -->

- Filesystem event filenames and shapes vary by operating system and Bun patch release; correctness cannot depend on temp-name heuristics. [paraphrase]
- Windows may preserve every tested fingerprint field for an in-place same-size edit with restored modification time; exact eligible paths must therefore always be content-hashed. [paraphrase]
- Atomic replacement with preserved size and modification time must still be discoverable through inode/change metadata and then content-hashed. [paraphrase]
- Snapshot scans must not follow symlinks outside the collection, while replacing a symlink itself with an eligible file remains discoverable. [paraphrase]
- Watcher startup begins event capture before snapshot construction; events observed during initialization are buffered and force a correctness-preserving reconciliation rather than being absorbed into the baseline. [paraphrase]
- Application-write suppression, collection-rule changes, root replacement, queued edits during synchronization, ABA remove/re-add, and disposal remain hard lifecycle boundaries. [paraphrase]
- Record-container sources use the same eligibility rules and preserve their multi-document inactivation semantics. [paraphrase]
- Snapshot entries, dirty-directory queues, suppression history, and debounce windows are bounded; sustained churn has a finite maximum flush delay. [paraphrase]
- The implementation defines one documented service-wide snapshot ceiling and falls back without losing updates when that ceiling is exceeded. [paraphrase]

## Acceptance Criteria
<!-- scope: both -->

- **R1:** On real filesystems, plain-temp and dot-temp atomic replacements become searchable through the running resident service without a manual update on macOS, Linux Bun 1.3.11/latest, and Windows Bun 1.3.11/latest. [strategy:Local knowledge lifecycle]
- **R2:** Recursive deletion removes every indexed descendant at multiple depths, post-watch directory creation indexes its eligible children when the platform emits an event, and untouched siblings remain searchable. [paraphrase]
- **R3:** An exact eligible event always reaches content hashing, including same-size/restored-mtime in-place edits whose filesystem fingerprint is unchanged; fingerprints are used only to discover unnamed candidates. [paraphrase]
- **R4:** For one changed file among 5,000 eligible siblings, ambiguous-event candidate selection submits only the changed path and meets p95 budgets of 250 ms on macOS/Linux and 500 ms on Windows. [paraphrase]
- **R5:** Snapshot initialization, forced ceiling overflow, scan failure, store failure, and unreliable-metadata fallback are covered by tests that prove no update or deletion is silently lost and no failed query infers inactivation. [paraphrase]
- **R6:** Suppression, configuration-generation changes, root changes, events during initialization or in-flight synchronization, disposal, and sustained unique-temp churn preserve existing lifecycle guarantees; churn flushes within a finite hard maximum delay with bounded memory. [paraphrase]
- **R7:** A live `gno serve` proof with a real store demonstrates atomic-save searchability, multi-depth deletion, untouched-sibling preservation, and API responsiveness without a manual update; the same watcher contract remains shared by daemon mode. [strategy:Coherent agent and application surfaces]

## Boundaries
<!-- scope: business -->

- Build a fresh maintainer PR and credit @DanielKillenberger; do not merge PR #183 as-is or import its unrelated branch history. [user]
- Do not add a global `mtime + size` ingestion shortcut or otherwise weaken content hashing for exact candidates. [paraphrase]
- Do not persist watcher fingerprints in the database in this first implementation; the selected normal path is watcher-owned memory with a bounded store fallback. [paraphrase]
- Do not add filename heuristics that assume one editor, temporary-file convention, operating system, or Bun patch behavior. [paraphrase]
- Do not claim reliable network/removable/coarse-timestamp filesystem behavior unless the correctness-preserving fallback is active and verified. [paraphrase]
- Do not broaden this work into unrelated synchronization, retrieval, or UI performance refactors. [paraphrase]

## Decision Context
<!-- scope: both — conditionally substructured -->

### Motivation
<!-- scope: business -->

- Correctness is worth bringing forward only if ambiguous events do not impose the measured multi-second unchanged-file cost on every sibling. [paraphrase]
- Performance risk is addressed before importing the watcher fix because the new reconciliation path makes the pre-existing cost reachable during normal service operation. [paraphrase]
- A fresh PR keeps contributor credit and the validated core idea while avoiding drift and unrelated scope from PR #183. [paraphrase]

### Implementation Tradeoffs
<!-- scope: technical -->

- A watcher-owned snapshot avoids a schema migration and makes unchanged-sibling selection cheap, at the cost of bounded memory and startup construction. [paraphrase]
- Persistent `mtime + size` shortcuts were rejected because preserved metadata can silently stale the index; Windows evidence also proves change time is not a universal unchanged-content proof. [paraphrase]
- Exact events remain conservative and hash content; only ambiguous-event candidate discovery uses fingerprints. [paraphrase]
- The bounded store reconciliation seam remains as a slower fail-safe for initialization races, limits, and metadata uncertainty rather than the normal path. [paraphrase]

## Strategy Alignment

- Reliable, automatic source-change recovery directly strengthens the active **Local knowledge lifecycle** track. [strategy:Local knowledge lifecycle]
- Keeping serve and daemon on one watcher/synchronization contract supports the active **Coherent agent and application surfaces** track. [strategy:Coherent agent and application surfaces]

## Strategy Conflicts

- No conflict detected with the local-first evidence-layer approach or any active strategy track. [paraphrase]

## Requirement coverage

| Requirement | Planned task |
| --- | --- |
| R1 | fn-N.M (TBD — populate via /flow-next:plan) |
| R2 | fn-N.M (TBD — populate via /flow-next:plan) |
| R3 | fn-N.M (TBD — populate via /flow-next:plan) |
| R4 | fn-N.M (TBD — populate via /flow-next:plan) |
| R5 | fn-N.M (TBD — populate via /flow-next:plan) |
| R6 | fn-N.M (TBD — populate via /flow-next:plan) |
| R7 | fn-N.M (TBD — populate via /flow-next:plan) |
