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
Quiet-by-default bar widget shipped: healthy = history glyph only; backlog pending/failed = circle/diamond count marks; stale = tilde composed with backlog marks; setup-guidance = question-circle; init-guidance = plus; degraded = warning triangle - every state pairs shape with Color.urgent/muted/foreground (no color-only signal) plus a state-naming tooltip. Service gained a distinct runtime-error state for RUNTIME envelopes (review note from .1), a stale property, and panelOpened tracking. Left-click toggles the nested Panel.qml loader (journal-evidenced, not the overlay IPC); middle-click refreshes; opened/open/close/toggle/closeForPopoutSwitch forward to the loader for the popout coordinator. Gates re-verified in-host (validate exit 0, qmllint exit 0). Live QA on the running shell captured healthy, setup-guidance (bogus gnoPath), and init-guidance (env-wrapper uninitialized gno) with screenshots + producing JSON in /tmp/fn-120.2-qa; session restored to ready/1673 docs.
## Evidence
- Commits: db88b77042b97f727601fa6dd2b2c7aed686bf3b
- Tests: omarchy plugin validate ., qmllint -I /usr/share/omarchy/shell (4 QML files), live bar-state captures /tmp/fn-120.2-qa
- PRs: