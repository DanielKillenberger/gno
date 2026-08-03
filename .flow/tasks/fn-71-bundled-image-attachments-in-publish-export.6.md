---
satisfies: [R4]
---
# fn-71-bundled-image-attachments-in-publish-export.6 Authorize public and secret raster delivery

## Description
Add visibility-specific raster delivery for v1 readers: immutable public URLs only for public shares, capability-authorized private delivery for secret shares, sentinel rewriting before Markdown parsing, and network/CSP/cache behavior that cannot cross share generations.

**Size:** M
**Files:** `/Users/gordon/work/gno.sh/src/routes/publish.tsx`, `/Users/gordon/work/gno.sh/src/lib/server/storage.ts`, `/Users/gordon/work/gno.sh/src/lib/publish-artifact.ts`, `/Users/gordon/work/gno.sh/test/`

### Approach
- Bind every asset request to the share visibility/generation established at ingest.
- Keep object storage private by default; public exposure is an explicit public-share projection.
- Resolve sentinels to authorized URLs before Markdown block rendering and prevent raw/internal identifiers from escaping.
- Test tokenless/expired/wrong-generation access, cache headers, and public immutability.

### Investigation targets
**Required** (read before coding):
- `/Users/gordon/work/gno.sh/src/routes/publish.tsx` — reader/request lifecycle
- `/Users/gordon/work/gno.sh/src/lib/server/storage.ts:53-83` — storage access layer
- `/Users/gordon/work/gno.sh/src/lib/publish-artifact.ts:117-152` — current embed stripping/render preparation
- `/Users/gordon/work/gno.sh/src/lib/source-catalog.ts:60-70` — generation manifest
- `/Users/gordon/work/gno.sh/docs/prd/publish-artifact-upload.md` — visibility/upload product rules

**Optional** (reference as needed):
- OWASP secure cloud storage guidance
- `/Users/gordon/work/gno.sh/docs/release-readiness-checklist.md:132` — deployed access proof

### Key context
A secret path or opaque object key is not authorization. Secret asset responses require the same share capability; public assets are assumed permanently public and immutable.

## Acceptance
- [ ] Public-share assets render from immutable public generation URLs and never expose source paths/internal sentinels.
- [ ] Secret-share assets require the matching capability on every request; tokenless, expired, wrong-share, and wrong-generation access fails.
- [ ] Sentinel rewriting completes before Markdown rendering and cannot leak private storage keys or raw `gno-asset:` values.
- [ ] Cache/CSP/content headers are correct for supported raster media and cannot mix generations or visibility classes.
- [ ] Focused reader/network/access tests and gno.sh gates pass.


## Done summary
Implemented and verified the bundled raster attachment contract end to end across GNO and gno.sh. The shipped work covers the versioned cross-repo contract, safe local attachment resolution, public/secret/encrypted delivery, transactional ingestion, renderer behavior, documentation, security hardening, and cross-repo release verification.
## Evidence
- Commits: 7129d3f609bf73b37286f253d5f7ea3bad80093a, 0948f4f8d30145e8671407ca4c1a5a1bcc73a9a1, 95163f597a4802b277f4b7f6e36337a12f34bebf
- Tests: bun run prerelease (3907 pass, 2 intentional skips, docs 15/15, package smoke passed), gno.sh bun run check && bun run typecheck && bun run build, cross-repo publish contract and live-site local QA
- PRs: https://github.com/gmickel/gno/pull/176, https://github.com/gmickel/gno.sh/pull/30