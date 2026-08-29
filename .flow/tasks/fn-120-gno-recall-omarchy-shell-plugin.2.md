---
satisfies: [R2]
---
# fn-120-gno-recall-omarchy-shell-plugin.2 Ship quiet bar widget health states

## Description
Replace the stub bar glyph with the R2 quiet-by-default widget: healthy = glyph only; backlog/stale and error/degraded are distinct and readable without color. Split from the panel so the always-visible surface can be QAed before the popup exists.

**Size:** S
**Files:** BarWidget.qml; Service.qml (state bindings only if a gap remains)
**Touches:** BarWidget.qml; Service.qml; manifest.json (barWidget display/category if needed)

### Approach
- Follow weather/clock BarWidget + qs.Ui.BarWidget / BarIconButton or WidgetButton (/usr/share/omarchy/shell/plugins/panels/weather/BarWidget.qml, /usr/share/omarchy/shell/plugins/panels/clock/BarWidget.qml, develop.html custom-clock). moduleName = plugin id. Expose opened / open / close / toggle / closeForPopoutSwitch forwarding to the still-stub Panel.qml Loader so the bar popout coordinator keeps working.
- Left-click toggles the nested panel (panelLoader.item.toggle()), not omarchy-shell shell toggle <id> — that IPC path belongs to the overlay once both kinds exist (shell.qml isBarWidgetPanelPlugin is false when overlay is declared; radio-atlas bar click summons its overlay on purpose, which is the wrong product for R3).
- Bind visuals to bar.shell.serviceFor(moduleName) states. Healthy = glyph only. Actionable: backlog badge from peek backlog.pending / backlog.failed (fn-119.1 meanings), stale marker when last-good is shown, setup-guidance vs init-guidance vs degraded (R2). Pair glyph/badge shape with color (Color.urgent / Color.muted / Color.foreground from /usr/share/omarchy/shell/Commons/Color.qml) — no color-only signal.
- Settings from the widget entry (root.settings) must reach the service (service loaders do not inject settings). Forward gnoPath + refreshIntervalSec on onSettingsChanged.
- Live-install the checkout and photograph/note each distinguishable bar state. Drive peek via a local fn-119.1 gno build where possible; plugin-local missing-binary can be forced with a bogus gnoPath.

### Investigation targets
**Required**: /home/gordon/work/gno/.flow/specs/fn-120-gno-recall-omarchy-shell-plugin.md; /usr/share/omarchy/shell/plugins/panels/weather/BarWidget.qml; /usr/share/omarchy/shell/plugins/panels/clock/BarWidget.qml; /usr/share/omarchy/shell/Commons/Color.qml; /usr/share/omarchy/shell/plugins/services/media/BarWidget.qml
**Optional**: /home/gordon/.config/omarchy/plugins/akshar.radio-atlas/BarWidget.qml; /usr/share/omarchy/shell/plugins/bar/Bar.qml; /home/gordon/work/gno/.flow/tasks/fn-119-gno-peek-command-desktop-integration.1.md

### Key context
Bar click must not call omarchy-shell shell toggle <id> or it will open the overlay, not the anchored panel. firstPartyServiceFor is only an alias of serviceFor — use serviceFor for this third-party id.

## Acceptance
- [ ] Healthy index shows a quiet glyph only; backlog/stale and error/degraded are visually distinct without relying on color alone.
- [ ] Plugin-local missing/not-executable/version-skew shows setup-guidance; peek initialized:false shows init-guidance; RUNTIME envelope shows degraded; last-good + stale marker when refresh fails.
- [ ] Left-click toggles the nested panel loader (not the overlay IPC path).
- [ ] Installed from the local checkout onto the live Omarchy session; evidence captured for healthy glyph, backlog or stale badge, and at least one plugin-local error state (screenshots + the real peek/error JSON that produced each).

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
