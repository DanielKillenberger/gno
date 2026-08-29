---
satisfies: [R1, R9]
---
# fn-120-gno-recall-omarchy-shell-plugin.1 Scaffold plugin repo, manifest, and Service discovery

## Description
Create the new public plugin repository (name parked — confirm with the user before gh repo create) and land a validating Omarchy plugin: manifest.json, README, license, stub surfaces, and a Service.qml singleton that discovers gno and can invoke gno peek --json. Split here so later surfaces share one Process/cache owner instead of each spawning CLI calls.

**Size:** M
**Files:** manifest.json; README.md; LICENSE; Service.qml; BarWidget.qml (stub); Panel.qml (stub); RecallOverlay.qml (stub)
**Touches:** manifest.json; README.md; LICENSE; Service.qml; BarWidget.qml; Panel.qml; RecallOverlay.qml

### Approach
- Confirm parked names with the user before publishing metadata freezes: repo name (omarchy-gno-recall vs gno-omarchy), plugin id (must NOT be omarchy.* — validate rejects that namespace in /usr/share/omarchy/bin/omarchy-plugin-validate), display name (working name GNO Recall).
- Manifest kinds must be service + bar-widget + overlay with keepLoaded: true. Do not declare kind: panel. Official develop guide and first-party clock/weather keep the anchored popup as an internal Panel.qml loaded by BarWidget.qml; a panel kind is a standalone summonable surface (OSD/speedtest/dev-gallery) and would steal omarchy-shell shell toggle <id> away from the overlay (/usr/share/omarchy/shell/shell.qml isBarWidgetPanelPlugin / computePanelEntries prefer panel over overlay).
- Follow radio-atlas + media for the multi-kind split: /home/gordon/.config/omarchy/plugins/akshar.radio-atlas/manifest.json (overlay + bar-widget, keepLoaded) and /usr/share/omarchy/shell/plugins/services/media/manifest.json (service + bar-widget). entryPoints: service → Service.qml, barWidget → BarWidget.qml, overlay → RecallOverlay.qml.
- barWidget block: defaultSection right, allowMultiple false, settings schema for absolute gnoPath (empty = PATH fallback) and coarse refreshIntervalSec (minutes; github default 900s is the pattern). Id pattern: author.plugin like robzolkos.github / akshar.radio-atlas.
- Service is the only Process owner. Bar widgets look up bar.shell.serviceFor(<id>) (media uses firstPartyServiceFor, an alias — third-party must use serviceFor). Overlay loaders get item.service injected when the property exists (shell.qml ~637). Do not embed a second Service {} in Panel the way github does — that would duplicate peek polls.
- Discovery (R9): configurable absolute path, then PATH lookup; invoke as argv arrays via Quickshell.Io.Process + StdioCollector (pattern: /home/gordon/.config/omarchy/plugins/robzolkos.github/Service.qml). Never shell-string interpolation. Bound stdout and a kill-timer (first-party Process has no timeout property). Distinct plugin-local states for not-found / not-executable / spawn failure / timeout / malformed / unknown-command (old gno without peek) / version-skew vs peek gnoVersion.
- Peek contract is fn-119.1 (peek@1.0). Develop against a local gno build of that task; uninitialized is exit 0 + initialized:false, not an error. Real failures are RUNTIME exit 2. Leave last-good snapshot + generation-id counters in the service now so later surfaces can show stale without a rewrite (R7 hardens and evidences them).
- README: omarchy plugin add <url> --enable, update, remove, privilege boundary (unsandboxed inside omarchy-shell), gno version floor placeholder, local-dev loop (omarchy plugin add "$PWD" --enable, omarchy plugin validate ., qmllint -I "$OMARCHY_PATH/shell"). Installer never runs hooks (omarchy-plugin-add) — keybind is a later documented script, not an add hook.
- Gate: omarchy plugin validate exit 0 and qmllint clean. Live-install onto this session (~/.config/omarchy/plugins/<id>/) and capture evidence that the stub loads without crashing the shell.

### Investigation targets
**Required**: /home/gordon/work/gno/.flow/specs/fn-120-gno-recall-omarchy-shell-plugin.md; /home/gordon/work/gno/.flow/specs/fn-119-gno-peek-command-desktop-integration.md; /home/gordon/work/gno/.flow/tasks/fn-119-gno-peek-command-desktop-integration.1.md; /usr/share/omarchy/bin/omarchy-plugin-validate; /usr/share/omarchy/shell/README.md; /usr/share/omarchy/shell/plugins/services/media/manifest.json; /home/gordon/.config/omarchy/plugins/akshar.radio-atlas/manifest.json
**Optional**: /home/gordon/.config/omarchy/plugins/robzolkos.github/Service.qml; /usr/share/omarchy/bin/omarchy-plugin-add; /usr/share/omarchy/shell/shell.qml; https://omarchyplugins.com/develop.html

### Key context
omarchy plugin add clones into ~/.config/omarchy/plugins/<manifest.id>/ (not ~/.local/share/omarchy). Local path add is allowed (bare path passes omarchy-git-url-check). Enabling a bar-widget writes bar.layout and that single isEnabled also mounts the service and overlay. Third-party ids cannot use omarchy.*. fn-119.1 is the peek contract; do not invent a second snapshot shape.

## Acceptance
- [ ] User confirmed repo name, plugin id, and display name (parked in spec); public repo exists with MIT (or chosen) LICENSE.
- [ ] manifest.json has schemaVersion 1, kinds service + bar-widget + overlay, keepLoaded true, matching entryPoints, and barWidget settings for gnoPath + coarse refresh; omarchy plugin validate . exits 0.
- [ ] qmllint -I "$OMARCHY_PATH/shell" is clean on the shipped QML files.
- [ ] README documents add/update/remove, privilege boundary, gno floor placeholder, and local omarchy plugin add "$PWD" --enable loop.
- [ ] Service discovers gno via configured absolute path then PATH, invokes peek as an argv array, and surfaces distinct not-found / not-executable / spawn / timeout / malformed / unknown-command / version-skew states without crashing the shell.
- [ ] Installed from the local checkout onto the live Omarchy session (~/.config/omarchy/plugins/<id>/); evidence captured: validate output, omarchy plugin list --json showing the id, and at least one real peek JSON or a plugin-local discovery-error state from the running shell.

## Done summary
Scaffolded the GNO Recall Omarchy plugin in the new public repo gmickel/omarchy-gno-recall (user-confirmed names: id gmickel.gno-recall, display "GNO Recall", MIT). manifest.json declares service + bar-widget + overlay with keepLoaded:true (no panel kind); entryPoints Service.qml / BarWidget.qml / RecallOverlay.qml; barWidget settings gnoPath (empty = PATH) + refreshIntervalSec (default 900, clamped 60-3600). Service.qml is the sole Process owner: argv-array Quickshell.Io.Process + StdioCollector, bounded stdout (256K), kill-timers with SIGKILL escalation, and distinct states not-found / not-executable / spawn-failure / timeout / malformed-json / unknown-command / version-skew plus ready/loading; lastGoodSnapshot + generationId already present for R7. BarWidget binds via bar.shell.serviceFor and pushes settings; RecallOverlay is a dismissible stub exposing a peekState IPC probe. README covers add/update/remove, privilege boundary, gno >= 1.36.0 floor, and the local-dev loop.

Gates re-verified in-host: omarchy plugin validate . exit 0; qmllint -I /usr/share/omarchy/shell clean on all four QML files. Live QA on the running Omarchy session: plugin installed + enabled, shell stayed up, and `omarchy-shell shell call gmickel.gno-recall peekState '{}'` returned state=ready with a real peek@1.0 snapshot from released gno 1.36.0 (initialized:true, 1673 documents). Evidence: /tmp/fn-120.1-qa/{validate,plugin-list,service-peek-evidence,qmllint}.log. Review note carried to .2: RUNTIME exit-2 envelopes currently surface under spawn-failure; give them a distinct health state.
## Evidence
- Commits: d7a90ca112f2b1dc3ef0ddc9d8b8d9f33e51ca85
- Tests: omarchy plugin validate ., qmllint -I /usr/share/omarchy/shell Service.qml BarWidget.qml RecallOverlay.qml Panel.qml, omarchy-shell shell call gmickel.gno-recall peekState {}
- PRs: