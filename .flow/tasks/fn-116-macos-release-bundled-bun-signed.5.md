# fn-116-macos-release-bundled-bun-signed.5 Permit bundled Bun to load Homebrew SQLite under hardened runtime

## Description
Fix the public macOS desktop launch failure on developer Macs where GNO selects Homebrew SQLite with a different Team ID. Scope disable-library-validation only to the bundled Bun runtime, strengthen the release gate and regression tests, document the rationale, and make the credentialed mounted-DMG CI self-test install and exercise Homebrew SQLite.

## Acceptance
Bundled Bun is signed with hardened runtime, allow-jit, and disable-library-validation; no other nested executable receives entitlements. Credentialed package-macos-desktop installs Homebrew SQLite and the mounted-DMG /api/status self-test passes without a new Bun crash report. Focused tests and full prerelease gate pass. v1.34.3 is published and its public DMG independently launches on a Homebrew-SQLite Mac.

## Done summary
Scoped allow-jit plus disable-library-validation to the bundled Bun runtime; strengthened signing checks and regression coverage; installed Homebrew SQLite in credentialed packaging; dry-run DMG passed notarization, mounted initialization, /api/status launch self-test, and no-new-Bun-crash guard.
## Evidence
- Commits: 729bb943eba1ec6465de788d833634c7fdf249c1
- Tests: bun test desktop/electrobun-shell/test/release-macos.test.ts desktop/electrobun-shell/test/release-macos-policy.test.ts desktop/electrobun-shell/test/publish-workflow.test.ts (47 pass, 0 fail), bun run lint:check (pass), bun test (4037 pass, 2 skip, 0 fail), bun run docs:verify (15 pass, 2 skip, 0 fail), GitHub Actions dry run 31283189776 attempt 2 (all required jobs pass; macOS job 93168879792 accepted/stapled, Homebrew SQLite init and mounted launch self-test pass, no new Bun crash report)
- PRs: