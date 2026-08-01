# fn-112 Baseline Receipt

**Schema:** `fn-112-baseline-receipt` v1
**Spec:** `fn-112-native-pdfjs-document-renderer`
**Base SHA:** `bb994b580356a41a31093fea85b06993c1a18e4c`
**Initial capture:** `cap-001` (not regenerated)

## Canonical baseline-compared commands (CBC)

1. `bun run lint:check`
2. `bunx tsc --noEmit`
3. `bun test`
4. `bun run test:web`
5. `bun run docs:verify`

## Capture `cap-001`

| Field | Value |
| --- | --- |
| regenerated | false |
| reason | null |
| worktree | `/home/claw/work/fn112-baseline-wt` (detached, removed after capture) |
| head_sha | `bb994b580356a41a31093fea85b06993c1a18e4c` |
| status_porcelain_empty | true |
| setup | `bun install --frozen-lockfile` exit 0; bun.lock unchanged |
| started_at | 2026-07-31T15:41:41Z |
| finished_at | 2026-07-31T15:45:40Z |

### Environment

- bun: 1.3.14
- typescript: Version 6.0.3
- platform/arch: Linux x86_64
- uname: Linux 7.0.0-27-generic

### Command results

| Command | Exit | Duration ms | Counts | Failures | Log SHA256 |
| --- | ---: | ---: | --- | --- | --- |
| `bun run lint:check` | 0 | 22544 | fail:0 | *(none)* | `ca9866857ce9e65b4e40630162095ab26eb0fbb5bde76da75c5e5169952e5bc4` |
| `bunx tsc --noEmit` | 0 | 29298 | fail:0 | *(none)* | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `bun test` | 0 | 160692 | 3463 pass / 0 fail / 2 skip | *(none)* | `6388cbbd315c5ac3f0ce434321d68872b20e4199048c705262394b153753ae47` |
| `bun run test:web` | 0 | 12845 | 186 pass / 0 fail | *(none)* | `098bdde9f4800f478e22cc5d0f0e2fdff1a2e5f5670f813e55fbefd7a6615283` |
| `bun run docs:verify` | 0 | 1620 | 15 pass / 0 fail / 2 skip | *(none)* | `252b59167a56c549a7c59a6c3d3d5f469e37dc10cb99e591ac5f7a662c1acc6d` |

**Enumerated pre-existing failures:** none. All five CBC commands exited 0 with empty `failures[]`.

### Planning worktree state (informational, non-gating)

- head: `bb994b580356a41a31093fea85b06993c1a18e4c`
- product_path_changes: **false** (initial capture only assertion)
- dirt: Flow planning artifacts only (spec, tasks, reviews, INVESTIGATION-REPORT.md, `.flow/.gitignore`)

Raw logs: `/tmp/fn112-baseline/cap-001/`
