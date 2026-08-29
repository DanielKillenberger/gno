---
satisfies: [R7]
---
# fn-120-gno-recall-omarchy-shell-plugin.6 Harden memory cache, generation IDs, timeouts, and theming

## Description
R7 hardening pass over the shared service and all three surfaces: prove memory-only last-good cache, generation-tagged refreshes, subprocess timeouts/size limits, and Omarchy-token-only theming. Split from feature work so the evidence matrix is run against the real bar/panel/overlay, not stubs.

**Size:** M
**Files:** Service.qml; BarWidget.qml; Panel.qml; RecallOverlay.qml
**Touches:** Service.qml; BarWidget.qml; Panel.qml; RecallOverlay.qml; README.md (cache/privacy note if missing)

### Approach
- Cache: last successful peek (and last successful search list if kept) lives only on the service QML object. No FileView / XDG state writes of titles, paths, or snippets (clipboard's history file is the anti-pattern). lastSuccessfulRefreshAt drives visible cache age. Quickshell restart (omarchy restart shell) must drop the cache — capture that.
- Generation IDs: every peek and search Process stamps a monotonic id; onExited no-ops unless it matches current. Coalesce overlapping peeks (refreshQueued in github Service). Timeout timer kills running and counts as a failed refresh (stale, not crash). Reject empty, truncated, non-JSON, and oversized stdout (radio-atlas bounds raw length before JSON.parse).
- Theme: grep the plugin for hex colors / hardcoded fonts; replace with Color.* / Style.* / Border.surfaceSpec. Overlay stays on Color.menu; panel on Color.popups; bar on bar.barForeground / Color.urgent. Re-check that every alarming state still has a non-color cue after a live omarchy theme set switch.
- Walk the R7 error surface on the live session: timeout, malformed peek, oversized output, late overlapping peek, shell restart, theme switch. Fix gaps found; do not start marketplace work here.

### Investigation targets
**Required**: /home/gordon/work/gno/.flow/specs/fn-120-gno-recall-omarchy-shell-plugin.md; /home/gordon/.config/omarchy/plugins/robzolkos.github/Service.qml; /usr/share/omarchy/shell/Commons/Color.qml; /usr/share/omarchy/shell/Commons/Style.qml
**Optional**: /home/gordon/.config/omarchy/plugins/akshar.radio-atlas/BarWidget.qml; /usr/share/omarchy/shell/plugins/clipboard/Clipboard.qml

### Key context
R7 is the refresh-path error surface. A green qmllint is not enough — cache-drop and late-result suppression only exist as evidence after a real shell restart and overlapped Processes.

## Acceptance
- [ ] Last-good cache is memory-only; a shell restart shows loading/empty recents, not restored titles/paths; cache age from lastSuccessfulRefreshAt is visible when stale.
- [ ] A late peek/search cannot overwrite a newer generation; overlapping peeks coalesce; every Process has a timeout and a max stdout bound; malformed/truncated/oversized output never crashes omarchy-shell.
- [ ] All colors/spacing/fonts come from Omarchy tokens; a live theme switch restyles bar, panel, and overlay; alarming states remain distinguishable without color.
- [ ] Installed from the local checkout onto the live Omarchy session; evidence captured for stale+age, timeout, malformed peek, late-result suppression, shell-restart cache-drop, and theme switch.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
