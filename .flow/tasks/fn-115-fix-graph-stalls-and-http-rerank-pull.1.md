---
satisfies: [R2, R3, R4, R5]
---
# fn-115-fix-graph-stalls-and-http-rerank-pull.1 Skip HTTP rerank endpoints during model pull

## Description
Make models pull and Web UI pull lifecycle treat HTTP rerank endpoints as external services rather than downloadable cache models.

## Acceptance
- HTTP and HTTPS rerank endpoints never call ModelCache isCached/getCachedPath/download, including force/all flows.\n- Result/formatting clearly reports an external-endpoint skip without a failure.\n- Local path, file:, and hf: model behavior remains unchanged; focused CLI and serve tests pass.\n- Specs/docs/changelog reflect the behavior.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
