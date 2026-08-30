## Why

PR #200 made production `gno serve` (the new default) serve the committed snapshot `assets/spa-production.json.gz`, and the serve tests exercise that same snapshot rather than a live build. Two drift hazards remain open:

1. A future PR that edits `src/serve/public/**` without rerunning `bun run build:spa` ships a stale WebUI while lint and the full test suite stay green.
2. `src/serve/public/lib/shiki-language-ids.ts` hardcodes ~340 language ids that must match the installed shiki's `bundledLanguages`. Verified exact match on 2026-08-30, but nothing pins it; a shiki bump that drops an id makes `highlighter.loadLanguage` throw at highlight time.

## What

1. Snapshot freshness guard: a test or CI step that runs `buildProductionSpaAssets()` and compares against `loadEmbeddedProductionSpa()` after normalizing `chunk-[a-z0-9]{8}\.js` names AND minified symbol assignment (builds from different Bun binaries differ only in symbol naming; the 2026-08-30 comparison found 4 chunks differing solely in one-letter symbol assignments). If byte-normalized comparison proves too brittle across Bun versions, fall back to regenerating the snapshot in publish.yml before `npm pack` instead.
2. Shiki pin test: test-only assertion that `BUNDLED_LANGUAGE_IDS` equals `new Set(Object.keys(bundledLanguages))` from the installed shiki (importing shiki in the test process is fine; the guard is about the browser first chunk, not tests).

## Acceptance

- R1: Editing any file under `src/serve/public/**` without refreshing the snapshot fails a check (test or CI), with a message naming `bun run build:spa`.
- R2: The freshness check passes on a snapshot built by a different Bun binary when content is equivalent (normalization handles hash names and symbol naming), OR publish regenerates the snapshot so published artifacts cannot be stale.
- R3: A shiki version where `bundledLanguages` diverges from `BUNDLED_LANGUAGE_IDS` fails `bun test` with a diff of the offending ids.
