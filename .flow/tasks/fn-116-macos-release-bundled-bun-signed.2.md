---
satisfies: [R3, R4]
---
# fn-116-macos-release-bundled-bun-signed.2 Assert the JIT entitlement post-sign and fail the release before notarization

## Description
Add a post-sign verification gate that asserts the JIT entitlement is actually present on the signed `bun`, and fail the release before notarization if it is not. Cover the parsing logic with unit tests.

### Why

This is the requirement whose absence let a crash-on-launch ship. The 1.29.6 artifact passed every existing check — `hdiutil verify` VALID, `codesign --verify --deep --strict` "valid on disk / satisfies its Designated Requirement", `xcrun stapler validate`, `spctl --assess` "accepted, source=Notarized Developer ID" — and still SIGTRAPped instantly. None of those checks inspect entitlements. A gate that reads back what was actually written to the signature is the only check that would have caught it.

fn-116.1 makes the entitlement get applied. This task makes it impossible to silently lose again.

### Load-bearing constraints (verified in-session)

- **`--deep` strips per-binary entitlements.** Because of this, the assertion must run *after* the final bundle sign, not just after the nested pass. Verifying only post-nested-pass would have gone green on a build that later lost the entitlement.
- **Target must be hard-coded to `Contents/MacOS/bun`.** A second `bun` exists at `Contents/Resources/app/gno-runtime/node_modules/@oven/bun-darwin-aarch64/bin/bun`, already fully entitled by Bun's own Developer ID. A glob or filename search would read that one's correct entitlements and report success while the real binary is still broken. This is a false-green trap, not a hypothetical.
- **Output-format trap, hit during investigation.** `codesign -d --entitlements - <path>` writes the `Executable=<path>` line to **stderr** and the entitlements to **stdout**. With no entitlements present, stdout is empty and the **exit code is still 0**. A gate keyed on exit status alone passes on a zero-entitlement binary. Additionally the default (non-`--xml`) form prints a human-readable `[Dict] / [Key] / [Value]` tree, while `--xml` prints a real plist. Use `codesign -d --entitlements - --xml <path>` and assert the key is present in stdout; treat empty stdout as failure. The deprecated `:` form (`--entitlements :-`) should not be used.
- **Key presence is not enough — the value must be `true`.** `<key>com.apple.security.cs.allow-jit</key><false/>` is a well-formed plist that contains the key while JIT stays disabled. A substring or key-presence check goes green on it. Parse the plist and assert the value is boolean true.
- **R3 also requires the hardened-runtime flag, not just the entitlement.** `codesign --verify` does not prove `--options runtime` survived. Read the CodeDirectory flags (`codesign -dvvv <path>`, which reports `flags=0x10000(runtime)` on **stderr**) and assert the runtime flag is still set on `Contents/MacOS/bun` at the same points the entitlement is asserted. An entitlement present without hardened runtime, or hardened runtime silently dropped, are both release-blocking.

### Approach

- Add the assertion inside `release-macos.ts`, not in `verify-packaged-runtime.ts`. That sibling script runs *before* signing and proves runtime function on the unsigned build; it is the wrong host for a post-sign signature assertion. This also matters because `.github/workflows/publish.yml`'s `package-macos-desktop` job only runs `bun scripts/release-macos.ts` and never inspects the artifact itself — a gate outside the script would not be enforced in CI.
- Assert after the final bundle sign and **before** `xcrun notarytool submit`, so a bad build costs a build rather than a release.
- The existing verification block runs twice (once after signing, once after the zip round-trip at ~line 350). Add the entitlement assertion at both points to match that existing redundancy — the second one proves `ditto` round-tripping preserved the signature.
- Failure mode: `throw new Error(...)` with a message naming the binary, the expected entitlement key, and the actual readback. Match the existing no-try/catch style; the script has no temp-dir cleanup on any current throw path, so do not add one here.
- Extract the output-parsing logic into a pure, exported function so it is unit-testable without a real signed binary. The codesign invocation itself stays behind the existing `runCommandCapture` helper.

### Tests

Repo convention is `test/scripts/*.test.ts` at repo root using `bun:test` (`describe`/`test`/`expect`), importing script internals directly — see `test/scripts/package-smoke-isolation.test.ts`. There are currently no tests for `desktop/electrobun-shell/scripts/*`.

Unit-test the pure parsing functions against real captured `codesign` output:

- XML output with `allow-jit` set to `<true/>` → pass
- XML output with `allow-jit` set to `<false/>` → **fail** (the key is present; the value is what matters)
- Empty stdout (the zero-entitlement case, exit 0) → fail
- XML plist with other entitlements but no `allow-jit` → fail
- Malformed / non-plist stdout → fail, no throw of an unrelated parse error
- `codesign -dvvv` stderr containing `flags=0x10000(runtime)` → runtime flag detected
- `codesign -dvvv` stderr with no runtime flag → fail

Also unit-test the pure target-selection and argument-construction functions that fn-116.1 extracted. This is the only normal-CI coverage the signing logic can get — `--dry-run` returns before it, and the credentialed release job only runs on release. Assert:

- the four `Contents/MacOS` extensionless Mach-O files are selected, and the vendored `@oven/.../bin/bun` is not
- `--entitlements` appears only in the `Contents/MacOS/bun` command, resolved by explicit relative path
- the helper commands (`launcher`, `bspatch`, `zig-zstd`) carry no `--entitlements`
- the extension-matched pass still selects the 18 `.dylib`/`.so`/`.node` files and carries no `--entitlements`
- the final bundle-sign argv does NOT contain `--deep` and does contain `--options runtime`

Do not attempt to unit-test the `codesign` invocation itself.

### Honest verification boundary — read before writing PR claims

We do not hold the project's Developer ID certificate or notarytool credentials, so the real release path cannot be run end to end here, and CI cannot run it on a fork either (`package-macos-desktop` needs `APPLE_CERT_P12_BASE64` and the notary secrets).

What HAS been verified, on the real shipped 1.29.6 artifact with ad-hoc signatures:

- Re-signing `Contents/MacOS/bun` with `allow-jit` clears the SIGTRAP at `pthread_jit_write_protect_np`. It does NOT get to a full boot under ad-hoc signing: the process then fails library validation (team-ID mismatch) and, once that is worked around, dies with `SIGKILL (Code Signature Invalid)` on JIT pages. Both are ad-hoc artifacts. A full ad-hoc boot needs `allow-unsigned-executable-memory` + `disable-library-validation`, which are test-only workarounds and must NOT ship.
- `--deep` strips the entitlement; the same sequence without `--deep` preserves it.
- A non-`--deep` bundle sign still yields `codesign --verify --deep --strict` → "valid on disk / satisfies its Designated Requirement" across all 23 Mach-O files.

What must NOT be claimed: that the change was verified under a real Developer ID identity, that notarization was re-run, or that CI proved it green. State the ad-hoc basis explicitly in the PR body and flag notarization-under-the-new-entitlement as unverified.

**R6 is NOT satisfied by this task — corrected after attempting it.** The attempt to close R6 under ad-hoc signing failed for reasons unrelated to the fix: an ad-hoc identity has no consistent team, so the app fails library validation and then JIT page validation (`SIGKILL (Code Signature Invalid)`). Making it boot required adding two broader entitlements that mask the very question R6 asks. R6 therefore requires a Developer ID build and has moved to fn-116.4 alongside R7. What this task DOES prove is that the changed signing path produces the intended signature state, verified by driving it over a real bundle with `--sign -` and running the gate against the result.

**R7 is the part that is genuinely not ours.** Notarization under the added entitlement, and a clean-machine launch of a Developer-ID-signed build, require credentials unavailable here and a CI release job that cannot run on a fork. R7 is maintainer-owned and documented by fn-116.3. Never claim it.

### Files

- `desktop/electrobun-shell/scripts/release-macos.ts`
- `test/scripts/*.test.ts` (new)

### Quick commands

```bash
cd /Users/daniel/Projects/gno
bun test test/scripts/
bun run lint:check
```

### Commit discipline

AGENTS.md requires docs in the same commit as the behavior change. fn-116.1, fn-116.2 and fn-116.3 land as ONE commit on the fn-116 branch covering code, tests and docs together. Do not commit this task standalone.
## Acceptance
- [ ] `release-macos.ts` asserts, after the final bundle sign and before `xcrun notarytool submit`, that `Contents/MacOS/bun` carries `com.apple.security.cs.allow-jit` with value boolean `true`.
- [ ] The same point also asserts the hardened-runtime flag is still set on `Contents/MacOS/bun`, read from `codesign -dvvv` stderr (`flags=0x10000(runtime)`). Entitlement-present-but-runtime-dropped fails the gate.
- [ ] Both assertions also run on the zip-round-tripped copy, alongside the existing second `codesign --verify` / `stapler validate` / `spctl` block.
- [ ] The assertion target is an explicit relative path. No glob, `find`, or filename search is used, so the vendored `@oven/bun-darwin-aarch64/bin/bun` can never satisfy the gate.
- [ ] The entitlement readback uses `codesign -d --entitlements - --xml` and inspects stdout. A binary with no entitlements (empty stdout, exit code 0) FAILS the gate rather than passing.
- [ ] A plist where `com.apple.security.cs.allow-jit` is present but set to `<false/>` FAILS the gate.
- [ ] On failure the script throws an `Error` naming the binary path, the expected entitlement key, and the actual readback, and does so before any notarization submission occurs.
- [ ] Entitlement parsing and runtime-flag parsing are exported pure functions taking the codesign output string and returning a boolean or structured result — no process spawning inside them.
- [ ] Unit tests exist under `test/scripts/` using `bun:test` and cover, for parsing: `allow-jit` true (pass), `allow-jit` false (fail), empty stdout (fail), other entitlements without `allow-jit` (fail), malformed non-plist stdout (fail without an unrelated parse throw), runtime flag present (pass), runtime flag absent (fail).
- [ ] Unit tests also cover the fn-116.1 target-selection and argv-construction functions: the four `Contents/MacOS` extensionless binaries are selected and the vendored `@oven` bun is not; `--entitlements` appears only in the `Contents/MacOS/bun` command; helper binaries carry no `--entitlements`; the extension-matched pass selects the 18 `.dylib`/`.so`/`.node` files with no `--entitlements`; the final bundle-sign argv omits `--deep` and includes `--options runtime`.
- [ ] Importing the module under test does not execute the release path or require signing credentials.
- [ ] `bun test test/scripts/` passes.
- [ ] `bun run lint:check` passes at repo root.
- [ ] A deliberate negative check was run locally: with the entitlement removed from the signed binary the gate fails; with it present the gate passes. Record the command and output in the task's Done summary.
- [ ] R6 verified end-to-end against the CHANGED code path, not by re-citing the pre-implementation diagnosis: run the new signing routine over a real `.app` bundle with an ad-hoc identity (`--sign -`), then launch the result on Apple Silicon and confirm it reaches `GNO server running at http://127.0.0.1:3927`. Confirm no new `bun` crash report with `EXC_BREAKPOINT` at `pthread_jit_write_protect_np` appears in `~/Library/Logs/DiagnosticReports/`. Record the exact commands and output in the Done summary.
- [ ] The R6 run also confirms the new gate passes on that artifact, and that `codesign --verify --deep --strict` on the bundle root still succeeds.
- [ ] R7 is NOT claimed. Notarization under the added entitlement, and a clean-machine launch of a Developer-ID-signed build, remain unverified and maintainer-owned.
## Done summary
- Task completed
## Evidence
- Commits:
- Tests:
- PRs: