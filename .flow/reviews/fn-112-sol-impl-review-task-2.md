# Sol implementation review — fn-112 task .2

- **Reviewer:** Sol (`gpt-5.6-sol`)
- **Stage:** per-task implementation review
- **Task:** `fn-112-native-pdfjs-document-renderer.2`
- **Verdict:** `NEEDS_WORK`
- **Review mode:** read-only
- **Reviewed:** 2026-07-31

## Blocking findings

1. **Required lint/typecheck gates fail.** `scripts/generate-test-fixtures.ts` has possibly-undefined page access, an unsafe cast, and unused variables; `src/serve/public/lib/pdf.ts` imports nonexistent `RenderParameters` from `pdfjs-dist`.
2. **The focused test is ignored.** `test/serve/public/lib/pdf.test.ts` is hidden by the repository `lib/` ignore rule and would be omitted from a normal commit.
3. **Unrelated fixture churn.** Existing DOCX/PPTX/XLSX/sample-PDF fixtures were nondeterministically regenerated and must be reverted; fn-112 fixture generation must not rewrite them.
4. **The JavaScript fixture is not an OpenAction.** It uses the names-tree JavaScript API and has no catalog `/OpenAction`.
5. **Generated fixtures are not fully reproducible.** `viewer-links.pdf` and `js-action.pdf` do not match isolated regeneration from the current script.
6. **Metrics/privacy evidence is partially vacuous.** `getDocument()` does not mint/use an opaque document-instance ID per load; privacy testing does not exercise a real load; snapshots do not prove returned event objects are frozen.
7. **Task state/evidence is inconsistent.** Task JSON evidence does not reflect the failed gates or a review receipt.

## Verified positives

- `pdfjs-dist` is exactly pinned to `5.7.284` in package and lockfile.
- Worker, cMap and standard-font URLs are configured locally.
- No scripting/eval weakening was found.
- Baseline receipt/raw-log hashes verified.
- New fixtures are under 100 KB and most semantic cases were confirmed.
- Focused test: `17 pass, 0 fail`.

## Commands/evidence

- `bun test test/serve/public/lib/pdf.test.ts` → 17 pass, 0 fail.
- `bun run lint:check` → failed with task-.2 errors.
- `bun x tsc --noEmit` → failed with task-.2 errors.
- Two isolated fixture generations showed nondeterministic churn and mismatches.
- Direct PDF.js inspection confirmed fixture semantics described above.

No repository files were changed by the reviewer.
