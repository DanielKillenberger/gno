# fn-112 task .3 repair round 4 (Grok 4.5)

- **Prior Sol:** `.flow/reviews/fn-112-sol-impl-rereview-task-3-round4.json` → **NEEDS_WORK** (I3-03 only)
- **Round3 receipt:** **superseded_incomplete**
- **Remaining gate:** independent Sol re-review **round 5** — **no Sol SHIP claimed**
- **Preserved closed:** I3-01, I3-02, I3-04, I3-05, I3-06; task .1/.2 SHIP

## I3-03 fix

Two same-component tests (no cleanup/remount):

1. **Deferred OLD getDestination** — build OLD internal link → click (destCalls>0, pageIndex not yet) → NEW owns → OLD dest last → no pageIndex, no nav, DOM snapshots unchanged.
2. **Deferred OLD getPageIndex** — click OLD link so dest resolves and pageIndex pending (both counts>0) → NEW owns → OLD pageIndex last → zero nav, no DOM mutation.

Production already guards after `getDestination` / `getPageIndex` with generation + cancelled checks.

## Commands

```
focused suite → 24 pass
test:web      → 231 pass
.1/.2         → 67 pass
lint/tsc/diff → 0
```
