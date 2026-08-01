# fn-112 task .4 repair round 2 — B4-R2 (Grok 4.5)

- **Owner:** Grok 4.5, sole writer
- **Task:** `fn-112-native-pdfjs-document-renderer.4`
- **Branch:** `feat/native-pdf-renderer`
- **Session:** `019fb8d5-7418-7a11-963b-1a206a7af924`
- **Prior Sol re-review:** `.flow/reviews/fn-112-sol-impl-rereview-task-4.json` → **NEEDS_WORK** (sole blocker **B4-R2**)
- **Prior repair receipt:** `.flow/reviews/fn-112-grok-implementation-task-4-repair.{md,json}` → **superseded_incomplete_for_B4_R2** (B1–B3 + other B4 source still closed)
- **No Sol SHIP claimed**
- **No** timeout paper-over (`setDefaultTimeout` / per-test timeout)

## Root cause

`usePdfPages.ensureRendered` correctly reads `genIdRef`/`scaleRef` for the live generation, but its `useCallback` identity did **not** list `genId`.

`PdfPageView` starts canvas work from:

```ts
useEffect(() => {
  if (!active) return;
  onRender(pageNumber, canvasRef.current);
}, [active, pageNumber, onRender, scale]);
```

On a viewer zoom/fit gen bump:

1. The gen effect cancels in-flight work for `startGenId !== genId` (correct).
2. `active` stays true.
3. `scale` may not re-fire `onRender` in every path / timing, and was never a sufficient contract for gen re-entry.
4. Because `onRender`/`ensureRendered` identity stayed stable, **no replacement `ensureRendered` ran**, so no higher-gen `renderStart` appeared until accidental late scale churn — the composition test therefore hung in `waitFor` until the default 5s timeout.

Task .3 unit tests never hit this hole because they **manually** re-call `ensureRendered` after bumping `genId`.

## Production fix (smallest correct integration)

File: `src/serve/public/hooks/use-pdf-pages.ts`

- Add **`genId` to `ensureRendered` `useCallback` deps** so identity changes on every gen commit.
- PdfPageView’s existing `onRender` effect then re-enters for active pages.
- `ensureRendered` still awaits single-owner cancel for old-gen in-flight tasks, then starts a higher-gen render.
- Preserved ordering: **old start < cancel < cancelled settle < higher-gen start**; no completed settle for the cancelled task; one settle per start.

No gen-effect rewrite, no architecture change, no task .3 contract drift beyond the intentional identity re-entry.

## Test fix (event-driven, <5s)

File: `test/serve/public/components/pdf/PdfViewer.dom.test.tsx`

- Metric **latches** (`waitForMetric`) resolve on push — no serial near-timeout `waitFor` for the gen sequence.
- Controlled `RenderTask` **next-task latch** for first and replacement tasks.
- Explicit IO drive: mount → page node → force column size → `emitVisible([1])`.
- Assert: nonzero start; zoom click; cancel same taskId; cancelled settle; start2 with `genId > old` and `seq` after cancelled settle; no completed settle for task1; one settle for task1.
- `finally`: settle leftover controlled tasks; restore canvas stub — no process hang.
- Single-page doc for a clean one-task cancel path.

## Commands / repeated timings

### Isolated integration (normal default timeout)

| Run | Result | Wall |
| --- | --- | --- |
| 1 | **pass** | **220 ms** |
| 2 | **pass** | **213 ms** |
| 3 | **pass** | **216 ms** |

Command: `bun test test/serve/public/components/pdf/PdfViewer.dom.test.tsx -t 'integration: viewer zoom gen commit'`

### Focused component suite (normal default timeout)

| Run | Result | Wall |
| --- | --- | --- |
| 1 | **39 pass / 0 fail** | **2.10 s** |
| 2 | **39 pass / 0 fail** | **1.94 s** |
| 3 | **39 pass / 0 fail** | **1.94 s** |

Command: `bun test test/serve/public/components/pdf`

### Other gates

| Command | Result |
| --- | --- |
| hooks + lib/pdf + fn112 routes + security | **69 pass** |
| `bun run test:web` | **260 pass** |
| `bun run lint:check` | 0 errors (after oxfmt) |
| `bunx tsc --noEmit` | clean |
| `git diff --check` | clean |
| `flowctl validate --spec fn-112…` | valid |

## Changed files

- `src/serve/public/hooks/use-pdf-pages.ts` — genId in ensureRendered deps + comment
- `test/serve/public/components/pdf/PdfViewer.dom.test.tsx` — event-driven composition proof
- prior repair receipt marked superseded for B4-R2 only

## Remaining gate

Independent Sol **round-3** re-review of task .4. **No Sol SHIP claimed.**
