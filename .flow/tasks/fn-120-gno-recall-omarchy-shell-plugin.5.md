---
satisfies: [R5, R6]
---
# fn-120-gno-recall-omarchy-shell-plugin.5 Add open actions, IPC summon, and conflict-checked SUPER+R

## Description
Wire result activation (R5) and the configurable summon path (R6): open source file via absPath, open web UI via the frozen deep-link, expose toggle IPC, and ship a conflict-checked SUPER+R install script that never overrides an existing bind.

**Size:** M
**Files:** Service.qml or OpenActions.qml (shared open helpers); Panel.qml; RecallOverlay.qml; scripts/install-keybind.sh (or equivalent); README.md
**Touches:** Service.qml; Panel.qml; RecallOverlay.qml; scripts/install-keybind.sh; README.md

### Approach
- Open source: argv-array Quickshell.execDetached / Util.execDetached on the default handler with peek absPath or search source.absPath (fn-119.2). If absPath is missing, disable file-open for that row (documented consumer rule in fn-119.2). Do not gno get.
- Open web UI: {serveUrl}/doc?uri=<encodeURIComponent(uri)> from peek serve.url (fn-119.2 / buildDocDeepLink in the gno repo). Prefer omarchy-launch-browser argv (tailscale panel) or github's omarchy-launch-webapp vs browser setting if you add a setting — default browser-tab is enough for v1. If serve.running is false, show guidance; never start serve. Open-action failure = non-blocking notice (github notificationActionStatus + short timer is the pattern).
- IPC: do not add a second IpcHandler unless a gap appears. The provided contract is already omarchy-shell shell {summon,hide,toggle} <id> (/usr/share/omarchy/bin/omarchy-shell → qs ipc -n -p $OMARCHY_PATH/shell call -- …). Toggle semantics are implemented in shell.qml. Overlay open/close/opened must stay accurate so toggle works. If IPC is down, log and leave bar/panel usable.
- Keybind install is a documented post-add script, not an omarchy plugin add hook (add never runs plugin code). Check current binds with omarchy menu keybindings --print and/or hyprctl binds (plain text — hyprctl -j binds is unreliable per /usr/share/omarchy/bin/omarchy-menu-keybindings). If SUPER+R is free, append o.bind("SUPER + R", "GNO Recall", "omarchy-shell shell toggle <id>") to ~/.config/hypr/bindings.lua per /home/gordon/.claude/skills/omarchy/hyprland.md. If taken, print the conflict, write nothing, leave summon unbound, document SUPER+N caveat and SUPER+G taken. Never hl.unbind as part of default install.
- README: default SUPER+R, conflict behavior, IPC one-liner, alternatives. Live-QA: IPC toggle, keybind install on a free key, a forced-conflict run, open-file, serve-down web-UI, open-file failure notice.

### Investigation targets
**Required**: /home/gordon/work/gno/.flow/specs/fn-120-gno-recall-omarchy-shell-plugin.md; /home/gordon/work/gno/.flow/tasks/fn-119-gno-peek-command-desktop-integration.2.md; /usr/share/omarchy/bin/omarchy-shell; /usr/share/omarchy/default/hypr/bindings/clipboard.lua; /home/gordon/.claude/skills/omarchy/hyprland.md
**Optional**: /usr/share/omarchy/bin/omarchy-menu-keybindings; /usr/share/omarchy/shell/plugins/panels/tailscale/Service.qml; /home/gordon/.config/hypr/bindings.lua

### Key context
SUPER+R is already verified free against Quattro defaults in the spec — do not re-litigate the default; only implement the conflict check. Plugin add cannot install the bind automatically.

## Acceptance
- [ ] Panel and overlay can open a result as a source file (default handler, absPath only) and in the web UI via {serveUrl}/doc?uri=<encodeURIComponent(uri)>; missing absPath disables file-open; serve-down disables/guides web-UI; failures are non-blocking notices.
- [ ] omarchy-shell shell toggle <id> summons when hidden and dismisses when shown; overlay opens on the focused monitor and grabs keyboard; Esc dismisses.
- [ ] Install script binds SUPER+R only when hyprctl binds / omarchy menu keybindings --print show the chord free; an existing bind prints a conflict and leaves summon unbound; no silent hl.unbind.
- [ ] README documents default, conflict check, IPC, and alternatives (SUPER+G taken; SUPER+N pre-Quattro collision).
- [ ] Installed from the local checkout onto the live Omarchy session; evidence captured for open-file, serve-down web-UI, open-file failure, IPC toggle, successful SUPER+R install, and a forced keybind-conflict run.

## Done summary
Open actions + configurable summon shipped. File-open: xdg-open (overridable) launched via Quickshell.execDetached with a fixed literal bash -lc 'exec "$@"' trampoline so dynamic absPaths travel only as positional args (session PATH needed for GUI handlers); peek absPath for recents, source.absPath for hits; missing absPath disables the action with a notice; never gno get. Web-open: omarchy-launch-browser at {serve.url}/doc?uri=<encodeURIComponent(uri)> (frozen fn-119.2 route); serve-down shows guidance and spawns nothing; plugin never starts serve. Opener spawn failures raise a github-style 3s actionStatus notice, UI stays interactive. Keys: overlay Enter=file Ctrl+Enter=web; panel recents Enter/click=file w=web. No second IpcHandler - shell {summon,hide,toggle} contract kept accurate. scripts/install-keybind.sh: conflict-checked via omarchy menu keybindings --print + hyprctl binds plain-text parse, appends the o.bind line to ~/.config/hypr/bindings.lua when SUPER+R free, idempotent re-run, prints conflict + writes nothing + exit 1 when taken, never hl.unbind. Live QA proved all paths on the real session incl. a real SUPER+R install (left in place per user intent, hyprctl configerrors empty), idempotency re-run, forced-conflict run with unchanged checksum, real file-open (nvim window spawned+killed), real web-open (Chromium loaded /doc deep link with serve up, then serve stopped). Gates: validate 0, qmllint 0, bash -n 0. Session restored ready/1673 docs, overlay+panel closed, serve down.
## Evidence
- Commits: ee45064687f88380ba9008a023c57eaca1530298
- Tests: omarchy plugin validate ., qmllint -I /usr/share/omarchy/shell, bash -n scripts/install-keybind.sh, live QA /tmp/fn-120.5-qa (open-file/no-abspath/serve-down/web-open/open-fail/ipc-toggle/keybind install+idempotent+conflict)
- PRs: