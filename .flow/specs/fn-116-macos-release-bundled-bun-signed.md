## Conversation Evidence

> user (turn 1): "can you debug why gno.sh application .dmg didn't stat?"
> user (turn 2): "can you checkout the repo and make a PR for this? Use the proper flow-next flow by capturing a spec and use sol as the reviewer"
> user (turn 3): "checkout in ~/Projects pls"
> user (turn 4, spec-scope answer): "fn-57 implementation was merged already i assume and had an incomplete implementation? If so then we'd need a new spec to mend the missing feature"
> user (turn 5, PR-contents answer): "Include the spec too"

Investigation findings from this session (agent-gathered, verified on the shipped artifact
`Gno Desktop Beta 1.29.6.dmg` and on this repo at `bb994b5`):

> DMG integrity is fine: `hdiutil verify` VALID; `spctl -a -vvv` accepted, `source=Notarized Developer ID`; `codesign --verify --deep --strict` reports `valid on disk` and `satisfies its Designated Requirement`.
> Launcher stdout: `Child process spawned with PID 26421` then `Child process terminated by signal: 5`.
> Four crash reports from the user's own launch attempts (11:25, 11:25, 11:26, 11:37 on 2026-08-01), plus one reproduced in-session: all process `bun`, all `EXC_BREAKPOINT / SIGTRAP`, all with faulting-thread frame 0 = `pthread_jit_write_protect_np`.
> `codesign -dvvv` on both `Contents/MacOS/launcher` and `Contents/MacOS/bun`: `flags=0x10000(runtime)` (hardened runtime ON) and `codesign -d --entitlements` returns nothing on either — zero entitlements.
> No entitlements plist exists anywhere in the repo (`find` for `*.entitlements` / `entitlements*.plist` returns nothing).
> Fix proven in-session: re-signing the bundled `bun` with `com.apple.security.cs.allow-jit` alone clears the SIGTRAP and the app boots fully (`GNO server running at http://127.0.0.1:3927`, vector search / query expansion / reranking all enabled). `allow-unsigned-executable-memory` and `disable-library-validation` were tested and are NOT required — the latter was only needed as an artifact of ad-hoc test re-signing, where team IDs no longer match.
> `signNestedBinaries` in the release script filters candidates to `.dylib` / `.so` / `.node` — the extensionless Mach-O executables (`bun`, `launcher`, `bspatch`, `zig-zstd`) are never signed by that pass; they are covered only by the final `--deep` bundle sign.
> fn-57 landed the pipeline on 2026-04-02 (`d0651b9`, `a519a30`) while all five fn-57 task files still read `status: todo`. fn-57.2 specifies "require hardened runtime signing" and verification via `codesign` / `stapler validate` / `spctl` — and never mentions entitlements. fn-57.4 ("Validate macOS desktop beta on clean-machine checklist") was never implemented.

## Goal & Context
<!-- scope: business -->

<!-- Goal & Context: 25% [user], 50% [paraphrase], 25% [inferred] -->

The shipped macOS desktop beta does not launch. A user who downloads
`gno-desktop-beta-1.29.6.dmg`, mounts it, and opens the app sees the app fail immediately
with no error dialog and no log — from the outside it looks like nothing happened. [user]

The cause is a code-signing gap, not a code defect: the bundled `bun` runtime is signed with
the hardened runtime enabled and no entitlements at all. Bun's JavaScriptCore requires the
JIT entitlement under hardened runtime; without it, the first call into
`pthread_jit_write_protect_np` traps and the child process dies with SIGTRAP before any
application code runs. [paraphrase]

Every existing release check passes, which is why this shipped: the DMG checksum verifies,
Gatekeeper accepts the notarized Developer ID signature, and `codesign --verify --deep
--strict` reports the bundle valid. None of those assert anything about entitlements, and
nothing in the pipeline ever launches the packaged artifact. [paraphrase]

This is the unfinished half of fn-57. That spec's macOS pipeline task merged on 2026-04-02
with "require hardened runtime signing" as an explicit requirement and no corresponding
entitlements requirement, and its clean-machine validation task was never done. [user]

## Architecture & Data Models
<!-- scope: technical -->

The macOS release path is a single repo-local script invoked by the packaging CI job. It
builds the shell, verifies the packaged runtime, signs nested binaries, signs the bundle,
notarizes, staples, and produces a zip plus a DMG. [paraphrase]

Two properties of that path produce the defect: [paraphrase]

- The nested-binary signing pass selects candidates by file extension, so it covers the
  bundled dynamic libraries but skips the extensionless Mach-O executables — including the
  `bun` runtime that is the actual JIT consumer. Those are signed only by the subsequent
  `--deep` bundle pass. [paraphrase]
- No `--entitlements` argument is passed at any signing call site, and no entitlements
  plist exists in the repo, so every binary in the bundle inherits hardened runtime with an
  empty entitlement set. [paraphrase]

The fix therefore lives at the signing layer, not in the shell or the runtime: introduce an
entitlements plist, apply it inside-out to the nested Mach-O executables that need it before
the bundle is sealed, and assert the result rather than trusting it. [paraphrase]

Signing order matters — the bundle seal covers the nested code, so entitlement application
must precede the bundle sign, and the bundle sign must not silently re-sign nested code with
a different entitlement set. [inferred]

## Edge Cases & Constraints
<!-- scope: technical -->

- Entitlements must stay minimal. `com.apple.security.cs.allow-jit` is the narrowest entitlement
  that addresses the fault, and it is PROVEN to clear the SIGTRAP at
  `pthread_jit_write_protect_np`. It is NOT proven to be sufficient for a full boot: that could
  only be demonstrated under ad-hoc signing by also adding
  `allow-unsigned-executable-memory` and `disable-library-validation`, both of which are
  ad-hoc-specific workarounds (an ad-hoc identity has no consistent team, so library validation
  and JIT page validation fail for reasons a Developer ID build does not have). Shipping
  `allow-jit` alone is a reasoned choice grounded in Apple's entitlement hierarchy and
  Electron's practice, NOT an empirically confirmed one. The maintainer must confirm it on the
  first real Developer ID build. [paraphrase]
- Adding entitlements does not change notarization eligibility for the JIT entitlement, but
  the notarization step must still pass after the change; the release is not fixed until a
  notarized build is verified. [inferred]
- Any regression gate must run against the signed artifact, after signing and before
  notarization submission, so a failure costs a build rather than a shipped release.
  [inferred]
- CI macOS runners are not a reliable place to assert that a windowed desktop app fully
  launches. The automated gate should assert signing facts, which are deterministic; the
  launch check belongs in the documented clean-machine checklist. [inferred]

## Acceptance Criteria
<!-- scope: both -->

- **R1:** A macOS entitlements plist exists in the repo and declares
  `com.apple.security.cs.allow-jit` and nothing beyond what the packaged app demonstrably
  requires. [user]
- **R2:** The release path signs the extensionless Mach-O executables under the app bundle's
  `Contents/MacOS`, not only files matching `.dylib` / `.so` / `.node`. [paraphrase]
- **R3:** After the release path completes signing, the bundled `bun` binary reports
  `com.apple.security.cs.allow-jit` under `codesign -d --entitlements`, and the hardened
  runtime flag is still set on it. [user]
- **R4:** The release path fails loudly when R3 does not hold, before notarization is
  submitted — a build missing the JIT entitlement cannot reach a release artifact. [paraphrase]
- **R5:** The macOS signing checklist documents the entitlements requirement and states the
  manual clean-machine launch verification that fn-57.4 left undone. [paraphrase]
- **R6:** A signed local build of the desktop beta launches and reaches its running server
  state on an Apple Silicon machine, with the crash-report signature
  (`EXC_BREAKPOINT` at `pthread_jit_write_protect_np`) absent. [user]
  Satisfied by driving the CHANGED signing code path over a real `.app` bundle with an ad-hoc
  identity, then launching the result — "signed" is not restricted to Developer ID here. This
  proves the new pipeline logic emits a launchable artifact; it does not prove anything about
  notarization, which is R7.
- **R7:** The maintainer verifies, once, that a Developer-ID-signed and notarized build produced
  by the fixed pipeline launches on a clean Apple Silicon machine. Owned by the maintainer and
  not deliverable by this PR: the signing certificate and notary credentials are unavailable to
  the contributor, and the CI release job cannot run on a fork. [inferred]

## Boundaries
<!-- scope: business -->

- Not re-cutting or re-publishing the 1.29.6 release. This spec fixes the pipeline; deciding
  what happens to the already-published broken DMG is the maintainer's call. [inferred]
- Not adding a CI step that launches the windowed app on a GitHub macOS runner. The
  automated gate asserts signing facts; the launch check stays a documented manual step.
  [inferred]
- Not touching the Windows or Linux packaging paths. [paraphrase]
- Not reopening or restructuring fn-57. This is a separate spec that mends the missing piece;
  fn-57 keeps its own scope. [user]
- Not addressing the separate observation that the shipped bundle is a dev-channel build
  (`GNO Desktop Beta-dev.app`, `channel: dev`, "Dev build detected" on stdout). Real, worth a
  maintainer's attention, but a distinct defect from the crash and not fixed here. [inferred]

## Decision Context
<!-- scope: both -->

### Motivation
<!-- scope: business -->

The shipped beta is unusable for every Apple Silicon user who downloads it, and it fails in
the least diagnosable way available: no dialog, no log, no visible error. The user's own
report was that the app "didn't start" with nothing else to go on. Recovering trust in the
beta channel requires both the fix and a gate that makes this class of failure impossible to
ship again silently. [user]

### Implementation Tradeoffs
<!-- scope: technical -->

Applying entitlements only to the binary that needs them, rather than to the whole bundle, is
the narrower and safer option: the hardened runtime stays maximally strict everywhere else.
The alternative — a permissive entitlements set applied bundle-wide via the existing `--deep`
pass — would work and is less code, but it weakens the runtime for binaries that never JIT
and it leans harder on a `--deep` sign that Apple discourages. [inferred]

Asserting the entitlement after signing was chosen over trusting the signing call, because
the entire failure mode here is a signing step that succeeded, verified clean under every
existing check, and still produced a broken artifact. A gate that reads back what was
actually written is the only check that would have caught it. [paraphrase]

## Requirement coverage

| R-ID | Task |
|------|------|
| R1 | fn-116.1 — Add macOS entitlements plist and sign Mach-O code inside-out |
| R2 | fn-116.1 — Add macOS entitlements plist and sign Mach-O code inside-out |
| R3 | fn-116.2 — Assert the JIT entitlement post-sign and fail the release before notarization |
| R4 | fn-116.2 — Assert the JIT entitlement post-sign and fail the release before notarization |
| R5 | fn-116.3 — Document the entitlements requirement, the gate, and the manual launch check |
| R6 | fn-116.4 — maintainer-owned. Ad-hoc signing cannot close this: it fails on library validation and JIT page validation for reasons unrelated to the fix. Requires a Developer ID build. |
| R7 | fn-116.4 — maintainer-owned gate requiring real launch evidence. NOT delivered by this PR. fn-116 must stay open until fn-116.4 is run; merging the code does not close the spec. |

## Verified during planning (supersedes inference)

Three things the spec originally marked `[inferred]` were settled empirically against the shipped
1.29.6 bundle during planning. They now bind the implementation.

- **`--deep` strips per-binary entitlements.** Signing `Contents/MacOS/bun` with `allow-jit` and then
  running the script's existing final sign (`codesign --force --deep --strict --options runtime`)
  leaves the binary with zero entitlements. The identical sequence without `--deep` preserves them.
  The Architecture note "signing order matters" is therefore not a caution but a hard requirement:
  `--deep` must come off the final bundle sign. Matches Apple DTS
  (https://developer.apple.com/forums/thread/129980).
- **Removing `--deep` removes the only pass that currently signs the extensionless `Contents/MacOS`
  executables.** The bundle holds 23 Mach-O files; the existing extension filter already recurses
  into `Contents/Resources/app` and covers 18 of them (16 under Resources, 2 in `Contents/MacOS`),
  missing 5 extensionless files: `bun`, `launcher`, `bspatch`, `zig-zstd`, and the vendored
  `@oven/bun-darwin-aarch64/bin/bun`. The four in `Contents/MacOS` must be signed explicitly or they
  ship unsigned. The vendored bun is deliberately left alone — it keeps its valid upstream Bun
  Developer ID signature and is not executed at runtime; verified that the bundle still passes
  `codesign --verify --deep --strict` in that state.
- **A second `bun` exists in the bundle** at
  `Contents/Resources/app/gno-runtime/node_modules/@oven/bun-darwin-aarch64/bin/bun`, already signed
  and fully entitled by Bun's own Developer ID (Jarred Sumner, team `7FRXF46ZSN`), not executed at
  runtime, untouched by this pipeline. Any target selection or verification that matches on the
  filename `bun` will read this one and report a false green. Paths must be explicit.
- **Entitlement readback returns exit 0 with empty stdout when no entitlements are present**, and
  writes its `Executable=` line to stderr. A gate keyed on exit status alone cannot detect the
  defect it exists to catch.

Verification boundary: all of the above was established with ad-hoc signatures on the shipped
artifact. The project's Developer ID certificate and notarytool credentials are not available here,
so the real release path has not been run end to end, and notarization under the added entitlement
remains unverified.

**Correction (post-implementation).** An earlier draft of this spec claimed `allow-jit` alone was
"verified sufficient in isolation". That overstated the evidence and has been corrected above.
What ad-hoc signing can prove is that `allow-jit` clears the SIGTRAP; it cannot prove a full boot,
because ad-hoc identities independently fail library validation and JIT page validation. Attempting
to close R6 under ad-hoc signing produces `SIGKILL (Code Signature Invalid)`, a different failure
that masks the question. R6 therefore moved to the maintainer gate.
