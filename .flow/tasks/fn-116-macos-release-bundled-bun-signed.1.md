---
satisfies: [R1, R2]
---
# fn-116-macos-release-bundled-bun-signed.1 Add macOS entitlements plist and sign Mach-O code inside-out

## Description
Add a macOS entitlements plist and make the release script sign the app's Mach-O code inside-out, so the bundled `bun` actually carries `com.apple.security.cs.allow-jit` in the shipped artifact.

### Why

`desktop/electrobun-shell/scripts/release-macos.ts` signs everything with `--options runtime` (hardened runtime) and never passes `--entitlements`. Bun's JavaScriptCore needs the JIT entitlement under hardened runtime, so the packaged `bun` traps in `pthread_jit_write_protect_np` and dies with `EXC_BREAKPOINT / SIGTRAP` before any app code runs. Spec fn-116 has the full evidence trail.

### Two independent defects in the current signing path

1. **No entitlements anywhere.** No `.entitlements` plist exists in the repo and no signing call passes `--entitlements`.
2. **`signNestedBinaries` (`release-macos.ts:153-179`) selects targets by file extension** via `isCodeSignableExtension` (`.dylib` / `.so` / `.node`). The extensionless Mach-O executables under `Contents/MacOS` — `bun`, `launcher`, `bspatch`, `zig-zstd` — are never signed by that pass. They are currently covered only by the final `--deep` bundle sign at `release-macos.ts:261-276`.

### Load-bearing constraints (verified in-session, do not re-litigate)

- **`--deep` strips per-binary entitlements.** Reproduced on the shipped 1.29.6 bundle: sign `Contents/MacOS/bun` with `allow-jit`, then run the script's existing final sign (`codesign --force --deep --strict --options runtime`) and the entitlement is gone. Running the identical sequence *without* `--deep` preserves it. This matches Apple DTS guidance that `--deep` is "a serious mistake" (https://developer.apple.com/forums/thread/129980). **`--deep` must come off the final bundle sign, or this fix is silently undone.**
- **Removing `--deep` removes the only thing currently signing the 4 extensionless `Contents/MacOS` binaries.** They must be signed explicitly by the nested pass instead, or they ship unsigned and `codesign --verify` fails.
- **Child processes do not inherit parent entitlements** (Apple DTS, https://developer.apple.com/forums/thread/120647). The launcher spawns `./bun` as a separate process, so the entitlement must be on the `bun` binary itself — signing only the bundle would not fix this.
- **Entitlements are meaningful only on main executables, not dylibs/frameworks.** Do not bolt `--entitlements` onto the existing extension-filtered pass; that would entitle 18 dylibs/`.so`/`.node` files for no effect. The two target sets need separate signing calls.
- **Only `com.apple.security.cs.allow-jit` is required.** Verified sufficient in isolation on the real artifact. `allow-unsigned-executable-memory` and `disable-library-validation` are strictly broader weakenings of the hardened runtime and are NOT needed. Bun's own codesign doc lists five entitlements and uses `--deep`, but that recipe is for a flat single binary — do not cargo-cult it into a nested bundle.

### Bundle inventory (enumerated from the shipped 1.29.6 artifact)

23 Mach-O files total, and the split matters because it determines what loses coverage when `--deep` comes off:

- **18 extension-matched** (`.dylib` / `.so` / `.node`) — 2 in `Contents/MacOS`, 16 under `Contents/Resources/app`. The existing `walk` already recurses, so these are covered today and stay covered.
- **4 extensionless in `Contents/MacOS`** — `bun`, `launcher`, `bspatch`, `zig-zstd`. Covered today ONLY by `--deep`. These are what the new executables pass must pick up.
- **1 extensionless outside `Contents/MacOS`** — the vendored `Contents/Resources/app/gno-runtime/node_modules/@oven/bun-darwin-aarch64/bin/bun`.

**The vendored bun is the 23rd file, and after `--deep` is removed it is signed by neither pass.** That is deliberate, not an oversight: it already carries a valid Developer ID signature from Bun upstream (Jarred Sumner, team `7FRXF46ZSN`) with its own full entitlement set, and it is not executed at runtime — the launcher execs `./bun`, i.e. `Contents/MacOS/bun`. Verified locally that a non-`--deep` bundle sign leaves the whole bundle passing `codesign --verify --deep --strict` with this binary retaining its upstream signature. Preserve that signature; do not re-sign it. But state the decision explicitly in code comments so a future reader does not read the gap as an accident.

Never let target selection or verification match on the filename `bun` — it would hit the vendored copy and mask the real binary.

### Approach

- Add the entitlements plist. Place it at `desktop/electrobun-shell/macos/` — that directory already holds `Info.plist.fragment.plist`, which is the established convention for static plists shipped alongside the shell.
- Split the nested signing into two target sets with distinct signing calls: the existing extension-matched code (no entitlements, unchanged behavior), and the extensionless Mach-O executables under `Contents/MacOS` (signed explicitly, with `--entitlements` applied only where the JIT entitlement is actually required).
- Resolve the entitlement target by explicit relative path, not by filename search.
- Drop `--deep` from the final bundle sign. Keep `--force --strict --timestamp --options runtime`.
- Reuse the existing helpers — `runCommand`, `walk`, `isMachOBinary` (which uses `file -b`, the right detection method), `expectValue`. Match the `console.log(">>> ...")` logging idiom and the throw-on-failure error style; the script has no try/catch by design.

### Testability requirement

`release-macos.ts` currently calls `await main()` at module top level, so importing it executes the whole release path — a unit test that imports anything from this file will immediately fail on missing signing credentials. Guard the entrypoint with `if (import.meta.main)` (or move the pure logic into a side-effect-free module) as part of THIS task, so fn-116.2 can unit-test against it.

Split discovery from classification, because Mach-O detection is inherently impure (it needs filesystem I/O and the `file` subprocess) and cannot live in a pure function:

- An **impure discovery wrapper** uses the existing `walk` and `isMachOBinary` to produce candidates as `{ path, isMachO }` records. Not unit-tested.
- A **pure classifier** takes `appPath` plus that candidate list and returns the target sets (extension-matched pass vs `Contents/MacOS` executables pass vs deliberately-skipped). No I/O, no spawning.
- **Pure argv builders** take a target and return the `codesign` argument array.

`--dry-run` exits before any of this logic runs and the credentialed release job only runs during a release, so the pure classifier and argv builders are the only way this logic gets normal-CI coverage. fn-116.2 writes those tests; this task must make them writable.

### Commit discipline

`AGENTS.md` requires docs to be updated in the same commit as a behavior change. fn-116.1, fn-116.2 and fn-116.3 therefore land as **one commit** on the fn-116 branch covering code, tests and docs together. Do not commit this task standalone.

### Out of scope for this task

The post-sign verification gate is fn-116.2. Docs are fn-116.3. Do not migrate signing onto electrobun's native `build.mac.entitlements` config surface — that is a maintainer architecture decision, noted as a follow-up in the PR.

### Files

- `desktop/electrobun-shell/macos/*.entitlements` (new)
- `desktop/electrobun-shell/scripts/release-macos.ts`

### Quick commands

```bash
cd /Users/daniel/Projects/gno
bun run lint:check
bun scripts/release-macos.ts --dry-run   # from desktop/electrobun-shell, needs APPLE_SIGNING_IDENTITY + NOTARYTOOL_PROFILE set to dummy values
```
## Acceptance
- [ ] An entitlements plist exists under `desktop/electrobun-shell/macos/`, is valid XML (`plutil -lint` passes), and declares exactly one key: `com.apple.security.cs.allow-jit` set to `true`. It does NOT contain `allow-unsigned-executable-memory`, `disable-library-validation`, `disable-executable-page-protection`, or `allow-dyld-environment-variables`.
- [ ] `release-macos.ts` signs the extensionless Mach-O executables under the app bundle's `Contents/MacOS` (`bun`, `launcher`, `bspatch`, `zig-zstd`), detected via the existing `isMachOBinary` check rather than by filename list or extension.
- [ ] The `--entitlements` flag is applied to the `bun` executable resolved by explicit relative path (`Contents/MacOS/bun`). No code path selects a signing or verification target by globbing or searching for the filename `bun`.
- [ ] The extension-matched pass (`.dylib` / `.so` / `.node`) still signs the same 18 extension-matched files as before and does NOT receive `--entitlements`.
- [ ] The final bundle sign no longer passes `--deep`. It retains `--force`, `--strict`, `--timestamp`, `--options runtime`, and `--sign <identity>`.
- [ ] Signing is inside-out: every nested Mach-O target is signed before the bundle sign runs.
- [ ] The vendored `Contents/Resources/app/gno-runtime/node_modules/@oven/bun-darwin-aarch64/bin/bun` is NOT re-signed and retains its upstream Bun Developer ID signature. A code comment records that this is deliberate and why.
- [ ] After the change, all 23 Mach-O files in a signed bundle still pass `codesign --verify --deep --strict` on the bundle root.
- [ ] `release-macos.ts` no longer runs the release path on import: the entrypoint is guarded by `import.meta.main` (or the pure logic lives in a side-effect-free module). Importing the module in a test does not spawn `codesign` or require signing credentials.
- [ ] Mach-O discovery (impure, uses `walk` + `isMachOBinary`) is separated from target classification. The classifier is an exported pure function taking `appPath` plus `{ path, isMachO }` candidates and returning the target sets; the argv builders are exported pure functions. Neither performs I/O or spawns a process.
- [ ] `bun run lint:check` passes at repo root.
- [ ] `bun scripts/release-macos.ts --dry-run` still prints resolved config and exits 0 without mutating artifacts.
## Done summary
Added `desktop/electrobun-shell/macos/gno-desktop.entitlements` (exactly one key,
`com.apple.security.cs.allow-jit` = true) and reworked signing in
`desktop/electrobun-shell/scripts/release-macos.ts`.

Signing is now inside-out over two target sets: the existing extension-matched pass
(18 `.dylib`/`.so`/`.node`, no entitlements, unchanged) and a new pass over the
extensionless Mach-O executables directly under `Contents/MacOS` (bun, launcher,
bspatch, zig-zstd), with `--entitlements` applied only to `Contents/MacOS/bun`,
resolved by explicit relative path via `bundledBunPath()`. `--deep` is off the final
bundle sign; `--force --strict --timestamp --options runtime --sign` remain. The
vendored `@oven/bun-darwin-aarch64/bin/bun` is classified as `skipped` and keeps its
upstream Bun Developer ID signature, with the reason recorded in a code comment.

Impure discovery (`walk` + `isMachOBinary`) is separated from a pure exported
classifier `classifyNestedSigningTargets(appPath, candidates)` and pure exported argv
builders `buildNestedSignArgv` / `buildBundleSignArgv`. The entrypoint is guarded by
`if (import.meta.main)` so the module imports without running the release path.

Verified by driving the changed code over a real 1.29.6 `.app` with `--sign -`:
23 Mach-O files total = 18 extension-matched + 4 extensionless in Contents/MacOS + 1
vendored; `codesign --verify --deep --strict` on the bundle root reports "valid on
disk" and "satisfies its Designated Requirement"; `Contents/MacOS/bun` shows exactly
`com.apple.security.cs.allow-jit`/`<true/>` with `flags=0x10002(adhoc,runtime)`;
launcher/bspatch/zig-zstd carry no entitlements; the vendored bun still reports
`Authority=Developer ID Application: Jarred Sumner (7FRXF46ZSN)`.
## Evidence
- Commits:
- Tests: plutil -lint desktop/electrobun-shell/macos/gno-desktop.entitlements, bun run lint:check, APPLE_SIGNING_IDENTITY=dummy NOTARYTOOL_PROFILE=dummy bun scripts/release-macos.ts --dry-run, bun test test/scripts/
- PRs: