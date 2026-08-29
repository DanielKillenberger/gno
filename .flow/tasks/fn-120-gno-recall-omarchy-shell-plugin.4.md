---
satisfies: [R4]
---
# fn-120-gno-recall-omarchy-shell-plugin.4 Ship recall overlay with Enter-only search

## Description
Implement the summonable recall overlay (R4): cached recents immediately, keystroke title filter with zero subprocesses, Enter-only gno search --json --no-project-affinity, in-flight cancel + late-result drop. Split from open-actions so keyboard recall can be QAed before file/URL handlers exist.

**Size:** M
**Files:** RecallOverlay.qml; Service.qml (search Process + generation id)
**Touches:** RecallOverlay.qml; Service.qml

### Approach
- Overlay contract: open(payloadJson), close(), opened, toggle(), and user-Esc dismiss() that calls shell.hide(<id>) so openPanelIds stays consistent (emojis/dev-gallery). Host injects shell / manifest / service. keepLoaded: true already set in task 1 — required for <150ms summon-to-interactive from cache.
- Visual/input pattern: /usr/share/omarchy/shell/plugins/clipboard/Clipboard.qml and /usr/share/omarchy/shell/plugins/emojis/Emojis.qml — PanelWindow + WlrLayershell Overlay + WlrKeyboardFocus.Exclusive, Color.menu.* + Border.surfaceSpec("menu", …), local filterText rebuild with no Process. Place the card on the focused output (Hyprland.focusedMonitor / bar focusedScreenName() in /usr/share/omarchy/shell/plugins/bar/Bar.qml).
- Empty query = cached peek recent[]. Typing filters titles (and URI tails) in memory only. Enter runs one search via the service; changing the query or a new Enter cancels the in-flight Process and increments a search generation so a late onExited cannot apply. Flag: --no-project-affinity is mandatory (Quickshell CWD is meaningless). Limit -n is a named constant.
- Result rows (R4): title or URI tail; collection — peek recents have collection; search-result schema has no per-hit collection field (spec/output-schemas/search-results.schema.json) so derive from gno://<collection>/… URI, never invent a field; snippet; modified time from peek modifiedAt or search source.modifiedAt when present.
- Keyboard-only: summon → type → arrows → Enter (activate later in R5; this task may no-op activate) → Esc. Search failure/timeout = inline error, overlay stays up. Empty hits = explicit empty. Empty-but-initialized index = index-something copy, distinct from uninitialized.
- Live-install and capture: summon latency from cache, zero peek/search spawns while typing (watch gno processes or service counters), one search Process per Enter, late-result suppression (overlap two commits).

### Investigation targets
**Required**: /home/gordon/work/gno/.flow/specs/fn-120-gno-recall-omarchy-shell-plugin.md; /usr/share/omarchy/shell/plugins/clipboard/Clipboard.qml; /usr/share/omarchy/shell/plugins/emojis/Emojis.qml; /home/gordon/work/gno/spec/output-schemas/search-results.schema.json; /home/gordon/work/gno/.flow/tasks/fn-119-gno-peek-command-desktop-integration.2.md
**Optional**: /usr/share/omarchy/shell/shell.qml; /home/gordon/work/gno/spec/cli.md; /usr/share/omarchy/shell/plugins/bar/Bar.qml

### Key context
fn-119.2 freezes results[].source.absPath as the documented default (no --source flag). Search title is optional. Do not call gno get. Do not debounce-search on keystroke — that contradicts R4.

## Acceptance
- [ ] Overlay summon shows cached recents immediately; keystrokes filter that list with zero gno subprocesses per keystroke.
- [ ] Enter runs exactly one gno search --json --no-project-affinity -n <limit> argv-array; a new Enter cancels the prior Process and drops late JSON.
- [ ] Rows show title-or-URI-tail, collection (peek field or URI-derived), snippet, and modified time; empty / timeout / empty-but-initialized states are explicit and the overlay stays interactive.
- [ ] Full keyboard flow works without mouse: omarchy-shell shell toggle <id> → type → arrows → Esc dismisses and a second toggle reopens.
- [ ] Installed from the local checkout onto the live Omarchy session; evidence captured (screenshots + real search/peek JSON + observation that no per-keystroke gno appeared) for recents, local filter, committed search, empty results, and search timeout/failure.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
