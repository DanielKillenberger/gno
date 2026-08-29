# fn-121-search-snippet-quality-skip-frontmatter.1 Strip frontmatter from result snippets, prefer prose fallback

## Description
Display-layer snippet cleaning in pipeline result builders per spec. Reuse src/ingestion/frontmatter.ts. Apply in search.ts buildSearchResult default branch, vsearch.ts snippet assignments, hybrid.ts if applicable. Keep --full and --line-numbers raw. Keep snippetRange/line consistent. Unit + pipeline tests.

## Acceptance
No default snippet starts with a frontmatter fence for frontmattered docs; tag-match queries show prose; --full/--line-numbers unchanged; bun test and bun run lint:check green.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
