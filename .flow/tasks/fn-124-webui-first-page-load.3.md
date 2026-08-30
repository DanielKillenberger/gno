---
satisfies: [R3, R6, R7, R9]
---
# fn-124-webui-first-page-load.3 Lazy non-home routes and keep Shiki PDF graph off the first file

## Description
Lazy-load non-home routes and keep Shiki, PDF, and graph off the first JS file (R3, R6, R7, R9). Depends on task .1 because route-lazy is a no-op while the serve path still inlines.

**Size:** M
**Files:** `src/serve/public/app.tsx`, `src/serve/public/lib/code-language.ts`, `src/serve/public/components/ai-elements/code-block.tsx`, `test/serve/public/code-language.test.ts`, `test/serve/public/navigation.test.tsx`, `test/serve/spa-first-chunk.test.ts`
**Touches:** [src/serve/public/app.tsx, src/serve/public/lib/code-language.ts, src/serve/public/components/ai-elements/code-block.tsx, test/serve/public/code-language.test.ts, test/serve/public/navigation.test.tsx, test/serve/spa-first-chunk.test.ts]

### Approach
- Keep Dashboard and the app shell (WorkspaceTabs, HelpButton, QuickSwitcher, CaptureModal) eager. Lazy-load Search, Browse, DocView, DocumentEditor, Collections, Connectors, Ask, GraphView, TraceHistory behind `React.lazy` + `Suspense`. Leave `/clipper/pair` on the existing separate `root.render` branch.
- Stop value-importing `bundledLanguages` from `shiki` on the home graph. Use an allowlist (existing `LANGUAGE_ALIASES` plus a small known-id check) or a type-only / delayed lookup so unused grammars are not in the first file. Delay `createHighlighter` until a CodeBlock actually highlights (today it runs at module eval).
- After split + lazy, add `test/serve/spa-first-chunk.test.ts` that fetches production HTML and the first script and asserts that file is not the ~11.8 MB monolith and does not contain pdfjs, `react-force-graph-2d`, or Shiki language payloads.
- Do not restyle PDF (fn-112). Do not change retrieval. Existing PdfViewer / ForceGraph2D `lazy()` stays; the win is that their page modules are no longer on the home graph.

### Investigation targets
**Required** (read before coding):
- `src/serve/public/app.tsx:24-65` — static page imports and `routes` table
- `src/serve/public/app.tsx:359-364` — `/clipper/pair` separate render
- `src/serve/public/lib/code-language.ts:1` and `:44-46` — `bundledLanguages` value import
- `src/serve/public/components/ai-elements/code-block.tsx:36-47` — highlighter created at module eval

**Optional** (reference as needed):
- `src/serve/public/pages/DocView.tsx:104` — existing PdfViewer `lazy`
- `src/serve/public/pages/GraphView.tsx:41` — existing ForceGraph2D `lazy`
- `test/serve/public/code-language.test.ts` — alias + unknown-language + highlight smoke
- `test/serve/public/navigation.test.tsx` — Dashboard nav labels (Search, Collections, Graph, …)

### Key context
- Home chrome for later measurement is Dashboard `h1` "GNO" plus the Search nav button (`Dashboard.tsx` header + `<nav>`). HealthCenter is not in scope.
- Unknown fence language must keep the `text` fallback and must not throw.

### Acceptance
- [ ] Non-home page modules are `React.lazy`; Dashboard + shell stay eager; `/clipper/pair` unchanged
- [ ] First production JS file does not contain editor/markdown/ask/graph/pdf page modules
- [ ] Unused Shiki grammars, pdfjs, and `react-force-graph-2d` are absent from that first file
- [ ] Highlighter is not created at module eval; unknown languages still resolve to `text` without throw
- [ ] `bun test test/serve/public/code-language.test.ts test/serve/public/navigation.test.tsx` plus the first-file assertion test pass
## Acceptance
- [ ] Non-home routes are lazy; Dashboard and shell stay on the first graph
- [ ] First production JS file has no unused Shiki grammars, pdfjs, or force-graph, and is not the ~11.8 MB monolith
- [ ] Highlighter is delayed; unknown language → `text` without throw
- [ ] Focused public + first-file tests pass


## Done summary
Non-home routes (Search, Browse, DocView, DocumentEditor, Collections, Connectors, Ask, GraphView, TraceHistory) are `React.lazy` + `Suspense`. Dashboard, WorkspaceTabs, HelpButton, QuickSwitcher, CaptureModal, and `/clipper/pair` stay on the existing eager / separate-render paths.

`resolveCodeLanguage` uses a string-id allowlist instead of value-importing `bundledLanguages`. `createHighlighter` runs on first highlight, not at module eval. Unknown fence languages still resolve to `text` without throw.

Production first JS is a split entry (~481 KB) and does not contain pdfjs, `react-force-graph-2d`, Shiki grammars, or the editor/ask/graph page modules.

In-harness review: SHIP.
## Evidence
- Commits: fabd7add8e593b6aa6fe157d131167c1e3cc4650
- Tests: bun test test/serve/public/code-language.test.ts test/serve/public/navigation.test.tsx test/serve/spa-first-chunk.test.ts
- PRs: