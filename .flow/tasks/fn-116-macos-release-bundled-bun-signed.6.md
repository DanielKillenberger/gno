# fn-116-macos-release-bundled-bun-signed.6 Permit bundled Bun JIT executable memory on macOS 27 and detect all crash reports

## Description
A notarized v1.34.3 app passes clean-runner CI but macOS 27 beta kills Contents/MacOS/bun after Electrobun creates its Worker. The crash report proves SIGKILL (Code Signature Invalid), CODESIGNING Invalid Page, in a JIT-generated executable region. A Developer-ID-signed diagnostic adding only com.apple.security.cs.allow-unsigned-executable-memory to the already scoped Bun reaches /api/status and exits 0. Also make the release crash-report guard detect hidden .bun files and both user/system DiagnosticReports directories.

## Acceptance
Contents/MacOS/bun alone carries allow-jit, allow-unsigned-executable-memory, and disable-library-validation; post-sign release assertions and unit tests require all three; macOS launch gate fails on visible or hidden Bun .ips/.crash reports in readable user/system DiagnosticReports directories; docs explain the macOS 27 failure signature and exact entitlement scope; full local gate and credentialed dry run pass; public hotfix DMG passes notarization/signature/entitlement/Homebrew SQLite /api/status/no-new-crash verification on this Mac.

## Done summary
Implemented the macOS 27 hardened-runtime compatibility fix by granting only the packaged Bun executable `com.apple.security.cs.allow-unsigned-executable-memory` alongside the existing `allow-jit` and `disable-library-validation` entitlements. Added release-time entitlement readback assertions and expanded the signed-DMG crash guard to cover delayed, hidden, user, and system Bun diagnostic reports. Updated regression tests and packaging documentation.

Credentialed dry-run workflow 31285909445 passed all OS test lanes, pack-test, Windows packaging, and macOS packaging. macOS job 93175161902 verified Developer ID signing, required Bun entitlements plus hardened runtime, accepted Apple notarization (DMG submission 631553be-0f8e-459e-a0cd-c8817c60ab46), successful stapling/validation, Gatekeeper acceptance as Notarized Developer ID, mounted-DMG initialization against Homebrew SQLite, packaged runtime launch through the `/api/status` self-test, clean shutdown, and no new visible or hidden Bun crash report.
## Evidence
- Commits: 3b08da5ca6dd334543dd03a2e01b2c4fabba6288
- Tests: bun install --frozen-lockfile, bun test test/scripts/release-macos-signing.test.ts test/desktop/electrobun-shell.test.ts (49 pass, 0 fail), bun run lint:check, bun test (4039 pass, 2 skip, 0 fail; 33157 assertions; 478 files), bun run docs:verify (15 passed, 2 skipped), git diff --check, GitHub Actions dry run 31285909445: all jobs passed; package-macos-desktop job 93175161902 passed Developer ID signing, hardened-runtime entitlement readback, Apple notarization, app and DMG stapling, Gatekeeper, mounted-DMG Homebrew SQLite init, /api/status launch self-test, and delayed visible/hidden Bun crash-report guard
- PRs: