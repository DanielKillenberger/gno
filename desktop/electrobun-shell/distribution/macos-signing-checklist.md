# macOS Signing Checklist

Before shipping a signed desktop beta:

1. confirm bundle identifier
2. confirm Apple Developer team and certificate
3. confirm notarization credentials
4. build unsigned artifact
5. sign app bundle
6. notarize app bundle
7. staple notarization ticket
8. upload artifact to the beta channel location
9. publish matching release notes

If any of the above is missing, the desktop beta remains an internal/manual artifact, not a normal rollout path.

## Current repo release path

The shell now exposes a repo-local macOS release command:

```bash
cd desktop/electrobun-shell
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
NOTARYTOOL_PROFILE="notarytool-profile" \
bun run release:macos
```

What it does:

1. builds the shell
2. runs packaged-runtime verification
3. signs the nested Mach-O binaries and then the `.app` with hardened runtime,
   embedding `com.apple.security.cs.allow-jit`,
   `com.apple.security.cs.allow-unsigned-executable-memory`, and
   `com.apple.security.cs.disable-library-validation` from
   `desktop/electrobun-shell/macos/gno-desktop.entitlements` into
   `Contents/MacOS/bun`
4. asserts, before notarization is submitted, that `Contents/MacOS/bun` carries
   all three entitlements set to `<true/>` and still has the hardened runtime
   flag
5. submits a zip to `notarytool`
6. staples the app
7. validates with:
   - the entitlement + hardened-runtime assertion above, re-run on the
     zip-round-tripped copy
   - `codesign --verify --deep --strict`
   - `xcrun stapler validate`
   - `spctl --assess`
8. creates a final versioned zip from the stapled app
9. optionally creates and notarizes a DMG

### Why the entitlement assertions exist

`codesign --verify`, `stapler validate` and `spctl --assess` cannot detect a
missing entitlement. The 1.29.6 build passed all three, was correctly signed and
notarized, and still crashed instantly on launch: the bundled `bun` had the
hardened runtime with no entitlements, so JavaScriptCore trapped in
`pthread_jit_write_protect_np`. Only a readback of the signature catches this,
which is why step 4 exists and why it runs before notarization rather than after.

macOS 27 also validates executable JIT pages created during Electrobun Worker
startup. With `allow-jit` alone it kills Bun with `SIGKILL (Code Signature
Invalid)`, termination namespace `CODESIGNING`, indicator `Invalid Page`.
`com.apple.security.cs.allow-unsigned-executable-memory` is therefore required
for the launched Bun/JSC process. It remains scoped to `Contents/MacOS/bun`; the
app bundle, launcher, helper tools, and nested libraries do not receive it.

GNO intentionally selects Homebrew SQLite on macOS because Apple's SQLite does
not permit the native extensions used for vector search and stemming. Homebrew's
library is signed under a different Team ID. Hardened-runtime library validation
therefore rejects it unless the packaged Bun executable carries
`com.apple.security.cs.disable-library-validation`. This entitlement is not
applied to the app bundle, launcher, helper tools, or nested libraries.

Note that the entitlement is applied to `Contents/MacOS/bun` by explicit path. A
second, already-entitled `bun` is vendored under
`Contents/Resources/app/gno-runtime/node_modules/@oven/`; it keeps its upstream
Bun signature and is not executed at runtime. Never let a check match on the
filename alone, or it will read that copy and report a false pass.

`--deep` is deliberately absent from the signing calls. It re-signs nested code
with the bundle's own entitlements and silently strips per-binary ones. It is
retained on `--verify`, where it is correct.

### Clean-runner launch check

The credentialed macOS packaging job installs Homebrew SQLite and performs this
check against the mounted, stapled DMG on a clean Apple Silicon runner. It is
required before announcing a build:

1. mount the stapled DMG and run the packaged app in self-test mode
2. confirm it reaches `/api/status` and exits successfully rather than exiting
   silently or timing out
3. confirm no new visible or in-progress hidden `bun` crash report appeared in
   either `~/Library/Logs/DiagnosticReports/` or
   `/Library/Logs/DiagnosticReports/`

The failure signature to recognize is process `bun`, `EXC_BREAKPOINT` /
`SIGTRAP`, faulting frame `pthread_jit_write_protect_np`. From the user's side
this looks like nothing happening at all: no dialog, no log, no error.

If the app dies while loading `/opt/homebrew/opt/sqlite3/lib/libsqlite3.dylib`
with a different-Team-ID library-validation error, the Bun entitlement was
missing or stripped. A `CODESIGNING / Invalid Page` kill in a generated
executable-memory region points to a missing or stripped
`allow-unsigned-executable-memory` entitlement. Other bundled-dylib or
code-signature failures can still indicate an invalid nested or ad-hoc
signature.

Flags:

- `--app-only` - skip DMG creation
- `--skip-build` - reuse existing build output
- `--dry-run` - print resolved config and env use without changing artifacts

Artifacts are written under:

- `desktop/electrobun-shell/artifacts/release-macos/`

## CI release environment

The GitHub Actions release path expects a `release` environment with:

Secrets:

- `APPLE_CERT_P12_BASE64`
- `APPLE_CERT_PASSWORD`
- `KEYCHAIN_PASSWORD`
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`
- `APPLE_NOTARY_API_KEY_P8`

Vars:

- `APPLE_SIGNING_IDENTITY`

The workflow creates a temporary macOS keychain, imports the Developer ID
certificate, stores a `notarytool-profile`, and then runs:

```bash
cd desktop/electrobun-shell
bun run release:macos
```
