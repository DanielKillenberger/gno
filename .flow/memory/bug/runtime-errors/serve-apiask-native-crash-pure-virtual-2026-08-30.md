---
title: serve /api/ask native crash (pure virtual) in temp-home fixture env
date: "2026-08-30"
track: bug
category: runtime-errors
module: serve
problem_type: runtime-error
symptoms: POST /api/ask aborts serve with 'pure virtual method called' during generation; llama.cpp GGML_ASSERT seen same day in standalone query
root_cause: (unspecified)
resolution_type: fix
---

During fn-121 docs-example regeneration (2026-08-30), `POST /api/ask` crashed
the serve process with a native `pure virtual method called` abort during
answer generation. Environment: throwaway GNO home (`GNO_CONFIG_DIR`/
`GNO_DATA_DIR`/`GNO_CACHE_DIR` in /tmp), 9-doc fixture corpus, models
symlinked from the global `~/.cache/gno/models`, `gno serve` on port 3777,
gno 1.36.1 repo code. Search/query/get/docs/collections endpoints on the same
serve instance worked. Not yet reproduced against a normal home. A separate
standalone `gno query` in the same session hit a llama.cpp `GGML_ASSERT`
(fn-120.10 QA) - possibly related native-layer instability under
concurrent/fresh model contexts. Repro attempt + triage needed before
treating as release-blocking; ask answers work in normal daily use.
