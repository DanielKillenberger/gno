---
satisfies: [R5]
---
# fn-116-macos-release-bundled-bun-signed.3 Document the entitlements requirement, the gate, and the manual launch check

## Description
Update the release documentation and CHANGELOG so the entitlements requirement and the new verification gate are written down, and so the manual clean-machine launch check that fn-57.4 left undone is stated explicitly.

### Why

`AGENTS.md` requires docs to be updated in the same commit as a behavior change. Three docs currently describe the macOS release path in a way that becomes wrong once fn-116.1 and fn-116.2 land, and none of them mention entitlements at all. The deeper point: the reason this crash shipped is that "signed and notarized" was treated as sufficient proof of a working artifact. The docs should stop implying that.

### What to change

**`desktop/electrobun-shell/distribution/macos-signing-checklist.md`**
- Line 32, `3. signs the '.app' with hardened runtime` — must also state that nested Mach-O binaries are signed and that the JIT entitlement is embedded, naming the entitlements plist path.
- Lines 35-39, the validation list (`codesign --verify --deep --strict`, `xcrun stapler validate`, `spctl --assess`) — add the entitlement-presence assertion as a numbered step in sequence, and make clear it runs before notarization submission. Worth stating outright that the three existing checks cannot detect a missing entitlement, since that is exactly how 1.29.6 passed them and still crashed.

**`docs/DESKTOP-BETA-ROLLOUT.md`**
- "Signing prerequisites" (lines 57-64) lists team, cert, notarization credentials, bundle id, storage location — no entitlements. Add the entitlements file as a prerequisite and note the release path now gates on it.

**`docs/PACKAGING.md`**
- "Desktop: macOS" (lines 104-125) and "Verification Minimums" → "Desktop-specific proof" (lines 240-246) never mention entitlements or JIT. Add the JIT-entitlement requirement and the post-sign, pre-notarization assertion as a proof-point bullet, matching the existing bullet style.

**`CHANGELOG.md`**
- Add a `### Fixed` entry under `## [Unreleased]`, Keep a Changelog format per `AGENTS.md`. It should say the macOS desktop build now embeds `com.apple.security.cs.allow-jit` when signing the bundled runtime and that the release path fails before notarization if the entitlement is missing. Keep it user-facing: the observable fix is that the signed macOS desktop app launches instead of crashing on start.

**Manual clean-machine verification (the fn-57.4 gap)**

Add the launch check to the signing checklist as an explicit manual step: after stapling, on an Apple Silicon machine that has not run a dev build, mount the artifact, launch the app, and confirm it reaches its running server state. Give the failure signature to look for so the next person recognizes it instantly — process `bun`, `EXC_BREAKPOINT` / `SIGTRAP`, faulting frame `pthread_jit_write_protect_np`, visible in `~/Library/Logs/DiagnosticReports/`. State plainly that this step is manual and is not covered by CI.

### Scope notes

- Do NOT edit any `fn-57` task or spec file. docs-gap-scout suggested a traceability note there, but fn-57's task specs are historical records of what was built and rewriting them from an outside contribution is not ours to do. The relationship is already stated in fn-116's Boundaries, which matches the repo's existing convention (see the fn-82 → fn-59 prose reference).
- The fn-115 spec and its own task files under `.flow/specs/` and `.flow/tasks/` DO ship in the PR — that is an explicit requirement from the requester, and Flow completion updates their status and Done summaries as normal.
- **R7** must be documented as a manual, maintainer-owned release gate: a Developer-ID-signed, notarized build launched once on a clean Apple Silicon machine. Nobody outside the maintainer can run the credentialed pipeline, so the check has to live in the checklist. (R6 — the ad-hoc-signed launch proof — is closed by fn-116.2 and is not this task's concern.)
- No update needed to `distribution/README.md`, `desktop/electrobun-shell/README.md`, `CONTRIBUTING.md`, or `docs/WINDOWS.md`.
- There is no `docs/MACOS.md` and no website download page for the macOS desktop beta, so there is no user-facing install surface to correct.
- Do not document the electrobun native `build.mac.entitlements` config surface as the chosen approach — it is a noted follow-up, not what this PR implements.

### Files

- `desktop/electrobun-shell/distribution/macos-signing-checklist.md`
- `docs/DESKTOP-BETA-ROLLOUT.md`
- `docs/PACKAGING.md`
- `CHANGELOG.md`

### Quick commands

```bash
cd /Users/daniel/Projects/gno
bun run lint:check
```

### Commit discipline

AGENTS.md requires docs in the same commit as the behavior change. fn-116.1, fn-116.2 and fn-116.3 land as ONE commit on the fn-116 branch covering code, tests and docs together. Do not commit this task standalone.
## Acceptance
- [ ] `macos-signing-checklist.md` step 3 states that nested Mach-O binaries are signed and that the JIT entitlement is embedded, and names the entitlements plist path.
- [ ] `macos-signing-checklist.md` validation list includes the entitlement-presence assertion as a numbered step, positioned before notarization submission, and notes that `codesign --verify`, `stapler validate`, and `spctl --assess` cannot detect a missing entitlement.
- [ ] `macos-signing-checklist.md` contains a manual clean-machine launch-verification step naming the failure signature to look for (`bun`, `EXC_BREAKPOINT` / `SIGTRAP`, `pthread_jit_write_protect_np`, `~/Library/Logs/DiagnosticReports/`) and stating that it is manual and not covered by CI.
- [ ] `docs/DESKTOP-BETA-ROLLOUT.md` "Signing prerequisites" lists the entitlements file and states the release path gates on it.
- [ ] `docs/PACKAGING.md` macOS desktop section and "Desktop-specific proof" bullets mention the JIT entitlement and the post-sign, pre-notarization assertion, in the existing bullet style.
- [ ] `CHANGELOG.md` has a `### Fixed` entry under `## [Unreleased]` in Keep a Changelog format describing the fix in user-facing terms.
- [ ] No `fn-57` spec or task file is modified. The fn-115 spec and its own task files are included in the PR.
- [ ] R7 is documented in the signing checklist as a manual, maintainer-owned release gate (Developer-ID-signed + notarized build, launched once on a clean Apple Silicon machine), explicitly marked as not performed by this PR.
- [ ] Every doc claim matches what fn-116.1 and fn-116.2 actually implemented — no documented step describes behavior that does not exist in the merged script.
- [ ] `bun run lint:check` passes at repo root.
## Done summary
- Task completed
## Evidence
- Commits:
- Tests:
- PRs: