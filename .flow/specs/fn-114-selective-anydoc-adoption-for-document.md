## Conversation Evidence

> user (turn 1): "Would this be a better option for gno, check"
> user (turn 2): "Do a full test suite and if successful, capture a spec"
> user (turn 3): "before capturing, can we talk a bit about the rust dependency and your pdf results"
> user (turn 4): "sounds good and the office stuff passed all your tests?"
> user (turn 5): "worth doing some more tests on the pdf side of things to see if we can find out what is going wrong?"
> user (turn 6): "then do the pdf test"
> user (turn 7): "ok close the anamoly and then continue the differential testing"
> user (turn 8): "ok, so what do we need to do, adjust or capoture a spec, did we capture one yet?"
> user (turn 9): "do that, make sure all our evidence flows in, do anymore testing that you need if something is missing"

## Goal & Context
<!-- scope: business -->
<!-- Goal & Context: 20% [user] / 80% [paraphrase] -->

Evaluate and selectively adopt AnyDoc where it materially improves GNO's local document ingestion without weakening source fidelity, error semantics, portability, or release reliability. The completed differential shows a strong Office-format opportunity and an unacceptable PDF replacement risk. This spec turns that evidence into a narrow adoption path: improve DOCX, XLSX, and PPTX conversion while retaining the incumbent PDF converter. It supersedes the older Markit-specific converter evaluation rather than rewriting that historical assessment.

## Architecture & Data Models
<!-- scope: technical -->

- Route GNO's currently supported DOCX, XLSX, and PPTX inputs through one AnyDoc-backed converter adapter after its acceptance gates pass. [paraphrase]
- Keep PDF routed through the incumbent converter; AnyDoc must not become the PDF parser or fallback under this spec. [paraphrase]
- Consume the published native package through Bun's N-API compatibility layer, pinned to an exact reviewed version; do not shell out to a converter process during normal ingestion. [inferred]
- Preserve GNO's existing converter result, provenance, limit, and error contracts so indexing and retrieval consumers do not need a parallel data model. [paraphrase]
- No database schema change is required; this is a conversion-boundary replacement plus regression hardening. [inferred]

## API Contracts
<!-- scope: technical -->

- Existing CLI, MCP, REST, watcher, and indexing entry points remain unchanged; the conversion backend is an internal behavioral change. [paraphrase]
- Successful conversions continue to return Markdown plus converter identity/version provenance under the current conversion contract. [paraphrase]
- Password protection, corrupt input, unsupported input, size limits, timeouts, and empty extraction continue to map to GNO's established error categories. [paraphrase]
- A missing or incompatible native binary fails clearly and actionably rather than silently falling back to a lower-fidelity parser. [inferred]

## Edge Cases & Constraints
<!-- scope: technical -->

- AnyDoc v0.1.3 currently misclassifies the protected XLSX fixture as malformed; the GNO adapter must retain the existing permission-protected result. [paraphrase]
- Archive bombs, extreme XML nesting, repeated rows, huge spans, embedded-object amplification, malformed packages, and truncated files remain bounded by GNO limits and covered by adversarial tests. [paraphrase]
- Missing optional native packages and unsupported CPU/OS combinations must be exercised on GNO's supported release matrix. [inferred]
- Output must preserve sparse spreadsheet coordinates, merged cells, slide order, speaker notes, links, tables, embedded-object text, Unicode join controls, and deterministic ordering where present in source fixtures. [paraphrase]
- The package's upstream repository currently has a non-reproducible Node lockfile even though the published package installs successfully with Bun; adoption requires a clean published-package install gate and must not depend on repairing upstream source during GNO installation. [paraphrase]
- Image extraction, OCR, and newly supported legacy/ODF/e-book formats are separate product decisions, not implicit consequences of installing AnyDoc. [paraphrase]

## Acceptance Criteria
<!-- scope: both -->

- **R1:** DOCX, XLSX, and PPTX use the AnyDoc-backed adapter only after all criteria below pass; PDF remains on the incumbent converter with an explicit routing regression test. [paraphrase]
- **R2:** The conversion quality suite covers GNO's fixtures plus the 17-fixture Office differential corpus; all GNO content anchors remain present, all supported AnyDoc corpus fixtures convert successfully, and reviewed fidelity assertions cover structure—not merely non-empty output. [paraphrase]
- **R3:** A clean Bun install of the exact pinned published package loads its native binding and converts DOCX, XLSX, and PPTX on every GNO-supported release tier without requiring a local Rust toolchain. [inferred]
- **R4:** Protected, malformed, truncated, empty, oversized, and adversarial documents retain GNO's established error categories and resource ceilings; protected XLSX specifically returns the permission-protected category. [paraphrase]
- **R5:** Image-only/scanned PDFs no longer produce misleading page-marker-only success; they return an explicit OCR-required/unsupported result, while text, encrypted, corrupt, JavaScript-bearing, linked, Unicode, and multi-column PDF regressions retain incumbent behavior. [paraphrase]
- **R6:** Office outputs are byte-deterministic across repeated runs, and the acceptance report records cold start, warm median, memory, package footprint, and comparison with the incumbent; no supported format may exceed twice the incumbent warm median or add more than 50 ms on the canonical fixture without explicit review. [inferred]
- **R7:** User documentation, conversion/API contracts, changelog, dependency notices, hosted documentation where behavior is described, and the installed GNO skill are reconciled; the skill autoresearch evaluation passes before release. [paraphrase]

## Boundaries
<!-- scope: business -->

- PDF backend replacement is out of scope. [paraphrase]
- Building or bundling an OCR engine is out of scope. [paraphrase]
- Adding DOC, XLS, PPT, ODT, ODS, ODP, RTF, EPUB, or CSV support is out of scope; those formats need separate product and compatibility decisions. [paraphrase]
- Forking or patching `pdf-inspector` inside GNO is out of scope. [paraphrase]
- This spec does not authorize a release or production deployment; those remain separate post-implementation gates. [inferred]

## Decision Context
<!-- scope: both — conditionally substructured -->

### Motivation
<!-- scope: business -->

- AnyDoc is materially stronger for the Office formats GNO already supports, especially PPTX variants the current converter fails to extract. [paraphrase]
- A universal backend would be simpler in theory, but the PDF evidence shows that source fidelity matters more than backend uniformity. [paraphrase]
- Selective adoption captures the demonstrated Office benefit without exposing all indexed PDFs to known text corruption and retrieval loss. [paraphrase]

### Implementation Tradeoffs
<!-- scope: technical -->

- A Rust-backed N-API dependency increases binary packaging and platform-matrix responsibility, but the published package already ships the relevant native artifacts and loads successfully under Bun on the tested macOS tier. [inferred]
- Keeping separate Office and PDF adapters is less uniform than one converter, but preserves the better parser per format and keeps rollback localized. [inferred]
- The adapter must normalize AnyDoc failures into GNO's stricter error vocabulary rather than exposing upstream messages directly. [inferred]
- Broader format support remains deferred until each format has its own representative corpus, compatibility policy, and release evidence. [inferred]

## Evidence Baseline

<!-- Measured during the 2026-08-05 read-only differential. These observations are evidence inputs, not authored acceptance criteria. -->

### Candidate and upstream gates

- Candidate: AnyDoc v0.1.3, released 2026-08-04, using `pdf-inspector` v0.1.7.
- Rust full target suite: 179 passed, 1 intentionally ignored.
- Node binding/CLI suite: 13 passed after regenerating the disposable checkout's stale lockfile.
- Python binding suite: 8 passed.
- The committed upstream Node lockfile fails `npm ci` because its `@emnapi/runtime` resolution is inconsistent.
- The published npm package installs cleanly with Bun, loads the arm64 macOS native binding, and converts the three canonical GNO Office fixtures. Published native packages exist for macOS arm64/x64, Linux glibc and musl on arm64/x64, and Windows x64.

### Office differential

- AnyDoc converted 17/17 DOCX/XLSX/PPTX corpus fixtures and reproduced all 17 reviewed upstream snapshots byte-exact.
- Current GNO converters succeeded on 14/17 of the same corpus: DOCX 9/9, XLSX 2/2, PPTX 3/6. The three PPTX failures returned empty-extraction/corrupt results.
- Against the corpus reference text, current-converter occurrence recall averaged 83.91% for DOCX, 95.92% for XLSX, and 40.39% for PPTX. AnyDoc reproduced the reference outputs exactly by construction.
- Both candidates retained every asserted anchor in GNO's canonical DOCX, XLSX, and PPTX fixtures.
- Published-package N-API outputs were deterministic across five runs. Warm medians on the canonical fixtures were 0.38 ms DOCX, 0.19 ms XLSX, and 0.49 ms PPTX.
- Protected XLSX behavior is a known adapter gap: incumbent returns permission-protected; AnyDoc v0.1.3 reports a malformed/unreadable workbook.

### PDF differential and rejection evidence

- Matrix: 19 PDFs total, including fixtures, real text/layout documents, scans, encrypted, corrupt, and empty inputs; 13 valid text PDFs fed aggregate quality metrics.
- Occurrence-token recall: incumbent 99.71%; AnyDoc default 94.03%; AnyDoc with repeated-header stripping disabled 99.51%.
- Ordered-bigram recall: incumbent 97.39%; AnyDoc default 96.85%; AnyDoc without stripping 97.71%, while the representative multi-column paper remained worse than incumbent.
- The default repeated-header/footer heuristic reduced a five-page fixture to 32.2% occurrence recall; disabling it restored 100%.
- Unicode defects were traced to explicit upstream behavior: ZWNJ/ZWJ removal corrupts Persian shaping and emoji sequences, while presentation-form RTL reversal reversed already logical Persian text.
- Visual page validation showed scrambled author order, merged words, and interleaved columns/footnotes on a two-column academic paper.
- Isolated GNO retrieval found 4/4 diagnostic queries from incumbent output and 2/4 from either AnyDoc configuration; the Persian term and `lawsuits` were no longer retrievable.
- Both converters were deterministic across five PDF runs. Warm latency was broadly comparable; on a 451-page PDF the incumbent median was 686 ms versus AnyDoc 706 ms. AnyDoc's separate-process maximum resident set size was about 60 MB versus about 435 MB for the incumbent Bun process.
- AnyDoc correctly rejects image-only PDFs as OCR-required; the incumbent currently returns misleading page-marker-only success. This useful semantic improvement is retained as a targeted GNO fix without adopting AnyDoc for PDF.

## Requirement coverage

| Requirement | Planned task |
| --- | --- |
| R1 | TBD — populate via `/flow-next:plan` |
| R2 | TBD — populate via `/flow-next:plan` |
| R3 | TBD — populate via `/flow-next:plan` |
| R4 | TBD — populate via `/flow-next:plan` |
| R5 | TBD — populate via `/flow-next:plan` |
| R6 | TBD — populate via `/flow-next:plan` |
| R7 | TBD — populate via `/flow-next:plan` |
