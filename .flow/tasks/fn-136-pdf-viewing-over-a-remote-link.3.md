---
satisfies: [R1]
---
# fn-136-pdf-viewing-over-a-remote-link.3 PDF transport tier by size with HEAD probe

## Description
Implement R1 and prove the transport approach over the real link. Probe the asset size with a raw HEAD, then load small PDFs in one request and large PDFs with 1 MB range chunks and background fetching. This is the early proof point for the whole plan: it ends with a measured first paint over the relayed VPN link to the remote host.

**Size:** M
**Files:** `src/serve/public/lib/pdf.ts`, `src/serve/public/hooks/use-pdf-document.ts`, `test/serve/public/lib/pdf.test.ts`, `test/serve/public/hooks/use-pdf-document.dom.test.tsx`, `assets/spa-production.json.gz` (rebuilt locally for the proof measurement only; never committed by this task, task .5 commits the final snapshot)
**Touches:** [src/serve/public/lib/pdf.ts, src/serve/public/hooks/use-pdf-document.ts, test/serve/public/lib/pdf.test.ts, test/serve/public/hooks/use-pdf-document.dom.test.tsx]

### Approach
- Extend `GnoGetDocumentParams` (`src/serve/public/lib/pdf.ts:127-131`) with an optional transport hint (whole-file vs ranged) and map it in the facade (`pdf.ts:150-233`) to pdf.js options: whole-file → `disableRange: true`, `disableStream: false`, `disableAutoFetch: false`; ranged → `rangeChunkSize: 1 MB`, `disableAutoFetch: false`, `disableStream: true`. Export the size bound (8 MB) and chunk size as named constants next to the existing zoom constants (`pdf.ts:340-350`).
- In `use-pdf-document.ts` (sole caller, `:102`) issue a HEAD with a raw `fetch` before `getDocument` (the JSON helper at `src/serve/public/hooks/use-api.ts:33-110` always parses JSON and cannot be reused). Read `Content-Length`; on network failure, non-2xx, or a missing header fall back to the ranged hint. The probe runs once per document load and must respect the existing generation and stale guards; teardown semantics do not change.
- Keep every request same-origin against `/api/doc-asset` (fn-112 invariant); no new URLs.
- Tests: facade maps each hint to the expected pdf.js options; hook picks whole-file under the bound, ranged at or above it, and ranged on HEAD failure or missing header, using the existing fake `getDocument` seam from the dom test.
- Docs for the transport tier land in task .5 (`docs/WEB-UI.md` Native PDF Viewer paragraph) to keep this task's write surface disjoint from task .2.
- Proof measurement (R6 first pass): rebuild the snapshot with `bun run build:spa` for the measurement only and restore it with `git checkout -- assets/spa-production.json.gz` before committing (task .5 commits the final snapshot), run `gno serve` on the remote host behind its existing proxy, open a 50-page PDF of about 5 MB from this machine, and record from the browser network panel the request count, transferred bytes, and time to first painted page, next to the current VPN ping round trip to the remote host. Record the before numbers from a pre-change build when available. If the remote host is unreachable, record BLOCKED with the reason; the gate below applies to a failed measurement, not a missing one.

### Investigation targets
**Required** (read before coding):
- `src/serve/public/lib/pdf.ts:120-240` — facade and current transport options with their rationale comments
- `src/serve/public/hooks/use-pdf-document.ts:60-199` — load ownership, teardown, stale guards
- `test/serve/public/hooks/use-pdf-document.dom.test.tsx` — getDocument test double

**Optional** (reference as needed):
- `src/serve/routes/api.ts:2260-2306` — HEAD/Content-Length behaviour of the asset endpoint
- `notes/pdf-remote-viewing-investigation.md` — the verification plan and the numbers measured on 2026-09-02

### Key context
- With `disableStream: true` pdf.js cancels the full-body reader once ranges are advertised, so the whole-file tier must disable ranges explicitly or the first GET is thrown away.
- pdf.js range eligibility needs `Content-Length` above twice the chunk size; with a 1 MB chunk, files under 2 MB load whole anyway, which is consistent with the 8 MB bound.
- If the measured first paint is still above a few seconds with the transport change alone, stop and re-evaluate server-side rasterisation before task .4 and .5 continue; that decision is recorded in the spec's Decision context.
## Acceptance
- [ ] HEAD then a single GET for a PDF under 8 MB; no Range requests in the request log
- [ ] Ranged mode with 1 MB chunks and background fetch at or above 8 MB
- [ ] HEAD network failure, non-2xx, or missing Content-Length falls back to ranged mode without a document error
- [ ] Teardown still destroys the loading task exactly once; existing use-pdf-document tests pass
- [ ] Relay measurement recorded in the task done summary: request count, bytes, time to first painted page, and current round trip, against the pre-change numbers or an explicit note that no pre-change capture exists; or BLOCKED with the reason when the remote host is unreachable
- [ ] `bun test` and `bun run lint:check` pass
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:

