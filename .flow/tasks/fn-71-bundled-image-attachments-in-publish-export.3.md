---
satisfies: [R1, R4]
---

# fn-71-bundled-image-attachments-in-publish-export.3 Carry encrypted assets through v2 client-only rendering
## Description
Carry the validated asset bundle inside the v2 encrypted payload and render decrypted raster assets through scoped browser Blob URLs without exposing plaintext objects to server storage or leaking URLs across snapshot changes.

**Size:** M
**Files:** `src/publish/encrypted-export.ts`, `test/publish/encrypted-export.test.ts`, `/Users/gordon/work/gno.sh/src/lib/publish-artifact.ts`, `/Users/gordon/work/gno.sh/src/routes/publish.tsx`, `/Users/gordon/work/gno.sh/test/`

## Approach
- Encrypt descriptors and bytes under the existing v2 payload, preserving old v2 compatibility.
- Validate digest/type/size again after client decryption before creating object URLs.
- Resolve every sentinel before Markdown rendering; revoke Blob URLs on replacement, failure, navigation, and unmount.
- Keep the server blind to plaintext asset contents.

## Investigation targets
**Required** (read before coding):
- `src/publish/encrypted-export.ts:50-52,193` — current empty asset payload
- `/Users/gordon/work/gno.sh/src/lib/publish-artifact.ts:211-228` — snapshot construction
- `/Users/gordon/work/gno.sh/src/routes/publish.tsx` — reader lifecycle
- `/Users/gordon/work/gno.sh/src/lib/source-catalog.ts:60-70` — current placeholder manifest
- `docs/WEB-UI.md:867` — current `blob:` CSP policy

**Optional** (reference as needed):
- MDN object URL lifecycle guidance
- `/Users/gordon/work/gno.sh/docs/release-readiness-checklist.md:132` — deployed reader proof

## Key context
Blob URLs are capabilities scoped to the document; revocation is required. No decrypted v2 asset is persisted to server object storage or logs.

## Acceptance
- [ ] Asset-free and asset-bearing v2 payloads encrypt/decrypt compatibly and integrity failures reject the whole generation.
- [ ] Server-side storage/logging never receives plaintext v2 image bytes or derived public URLs.
- [ ] Client validation resolves every sentinel before render and produces real `<img>` elements with supported media types.
- [ ] Blob URLs are revoked on all lifecycle terminals; CSP remains least-privilege and tests detect leaks/stale URLs.
- [ ] Cross-repo encrypted fixtures, browser tests, and gates pass.

## Done summary
Implemented and verified the bundled raster attachment contract end to end across GNO and gno.sh. The shipped work covers the versioned cross-repo contract, safe local attachment resolution, public/secret/encrypted delivery, transactional ingestion, renderer behavior, documentation, security hardening, and cross-repo release verification.
## Evidence
- Commits: 7129d3f609bf73b37286f253d5f7ea3bad80093a, 0948f4f8d30145e8671407ca4c1a5a1bcc73a9a1, 95163f597a4802b277f4b7f6e36337a12f34bebf
- Tests: bun run prerelease (3907 pass, 2 intentional skips, docs 15/15, package smoke passed), gno.sh bun run check && bun run typecheck && bun run build, cross-repo publish contract and live-site local QA
- PRs: https://github.com/gmickel/gno/pull/176, https://github.com/gmickel/gno.sh/pull/30