# fn-121-search-snippet-quality-skip-frontmatter.1 Strip frontmatter from result snippets, prefer prose fallback

## Description
Display-layer snippet cleaning in pipeline result builders per spec. Reuse src/ingestion/frontmatter.ts. Apply in search.ts buildSearchResult default branch, vsearch.ts snippet assignments, hybrid.ts if applicable. Keep --full and --line-numbers raw. Keep snippetRange/line consistent. Unit + pipeline tests.

## Acceptance
No default snippet starts with a frontmatter fence for frontmattered docs; tag-match queries show prose; --full/--line-numbers unchanged; bun test and bun run lint:check green.

## Done summary
Search/query snippets now skip leading YAML frontmatter and prefer prose
(commit 63cd2aba, gno main).

- New display-layer helper `src/pipeline/snippet.ts` (reuses ingestion
  `stripFrontmatter`): strips a closed leading fence, keeps prose after an
  FTS window that straddles the closing fence when the prefix is YAML-like,
  falls back to stripped chunk prose for frontmatter-dominated windows, and
  never returns empty where content existed.
- Applied on default snippet paths only: search.ts buildSearchResult,
  vsearch.ts (both result builders), hybrid.ts. `--full` and
  `--line-numbers` untouched. `line`/`snippetRange.startLine` bumped by the
  stripped offset; endLine unchanged.
- Context Capsule provenance check relaxed minimally: endLine must still
  match the stored chunk exactly; startLine may sit within the chunk.
  passageHash remains over the full stored chunk text.
- Tests: test/pipeline/snippet.test.ts (11 pass incl. tag-match pipeline
  fixture), context-capsule 7/7; full suite 4389 pass with only the known
  pre-existing/base-commit failures (verified via stash-on-base).
- Demo: "vault agent skills portability" snippet now starts at the runbook
  heading (line 16) instead of the frontmatter fence at line 1.
## Evidence
- Commits: 63cd2aba
- Tests: bun test (4389 pass, known pre-existing failures only), bun run lint:check, test/pipeline/snippet.test.ts
- PRs: