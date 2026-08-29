---
satisfies: [R3]
---
# fn-120-gno-recall-omarchy-shell-plugin.3 Build anchored index panel from the bar widget

## Description
Implement the bar-anchored health panel (R3) as Panel.qml loaded by BarWidget.qml — index health, counts, backlog, recents, open-web-UI affordance, and a control that summons the recall overlay. Split from the overlay because this is a KeyboardPanel popup, not a fullscreen kind: overlay.

**Size:** M
**Files:** Panel.qml; BarWidget.qml (inject/hostWidget wiring)
**Touches:** Panel.qml; BarWidget.qml

### Approach
- Follow the official nested-panel contract (https://omarchyplugins.com/develop.html section 03 and /usr/share/omarchy/shell/plugins/panels/weather/Panel.qml): import qs.Ui Panel base, manageIpc: false (the plugin id's shell toggle is reserved for the overlay), anchorItem + hostWidget injected from BarWidget, KeyboardPanel + PanelKeyCatcher, Esc closes, Tab hands off via bar.switchPanelFrom.
- Tokens: Color.popups.* / Style.space / Style.font / Border.surfaceSpec("popups", …) — same family as KeyboardPanel.qml. No custom palette.
- On open, ask the shared service to refresh peek (coarse timer remains for the bar). Render last-good with an explicit staleness/cache-age marker when the in-flight refresh fails.
- Recents from peek recent[] (fn-119.1): title with URI-tail fallback, collection, modifiedAt. Rows are not required to open files yet (R5) but must be selectable. Header/footer actions: open GNO web UI (disable + guidance when serve.running is false — do not start serve) and summon overlay via omarchy-shell shell toggle <id> or bar.shell.toggle(<id>) (radio-atlas bar uses bar.run("omarchy-shell shell toggle …")).
- Empty-but-initialized (counts.documents == 0) vs uninitialized vs plugin-local error: three different copy blocks, never a blank panel.
- Live-install and drive: click glyph → panel; Esc; stale refresh; uninitialized vs empty; overlay-summon control (overlay may still be a stub that opens/closes).

### Investigation targets
**Required**: /home/gordon/work/gno/.flow/specs/fn-120-gno-recall-omarchy-shell-plugin.md; /usr/share/omarchy/shell/plugins/panels/weather/Panel.qml; /usr/share/omarchy/shell/Ui/KeyboardPanel.qml; /usr/share/omarchy/shell/Ui/Panel.qml; /usr/share/omarchy/shell/plugins/panels/clock/BarWidget.qml
**Optional**: /home/gordon/.config/omarchy/plugins/robzolkos.github/Panel.qml; https://omarchyplugins.com/develop.html; /usr/share/omarchy/shell/Commons/Style.qml

### Key context
Do not add kind: panel or entryPoints.panel. manageIpc: false is required so a leftover IpcHandler on the nested Panel does not collide with overlay summon on the same plugin id.

## Acceptance
- [ ] Clicking the bar glyph opens a KeyboardPanel anchored to the widget showing health, document/collection counts, backlog, and recents from the shared service snapshot.
- [ ] Failed refresh keeps last-good rows plus a visible staleness marker; empty-but-initialized and uninitialized are distinct copy, not a blank panel.
- [ ] Web-UI action is disabled with guidance when peek serve.running is false; plugin never starts gno serve.
- [ ] Panel control summons/dismisses the overlay via shell toggle; Esc closes the panel; no mouse required for open → navigate → Esc.
- [ ] Installed from the local checkout onto the live Omarchy session; evidence captured (screenshots + peek JSON) for healthy panel, stale-cache panel, uninitialized or empty-but-initialized, and serve-down web-UI affordance.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
