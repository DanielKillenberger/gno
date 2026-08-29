---
satisfies: [R11]
---
# fn-120-gno-recall-omarchy-shell-plugin.9 Guarantee Enter opens every document row with smart fallback

## Description
Guarantee Enter-opens-everywhere (R11): pressing Enter on any document row — recents, search hits, browsed collection docs, panel recents — actually opens the document, with smart fallback and explicit guidance when nothing can open.

**Size:** S
**Files:** Service.qml; RecallOverlay.qml; Panel.qml; README.md
**Touches:** Service.qml; RecallOverlay.qml; Panel.qml; README.md

### Approach
- Smart primary open in the shared service: openDocument(row) tries the source file first (absPath present/derivable → default handler via the existing argv trampoline); if no absPath, falls back to the web UI deep link when serve.running; if neither, raises the existing non-blocking notice with concrete guidance ("no file path; start gno serve --detach for web open"). The explicit web-open key (Ctrl+Enter overlay / w panel) stays on every row type.
- Audit every row type for Enter wiring: overlay recents, overlay search hits, overlay browsed docs (from .8), panel recents. Kill any silent no-op paths.
- README: document the open matrix (row type × Enter/Ctrl+Enter/w × file/web/fallback).
- Live verification per row type: a real window or browser tab must appear (journal argv + hyprctl clients/window title evidence, then close it). Include the fallback path (row without absPath + serve up → web opens) and the double-failure guidance path.

### Key context
R5 shipped Enter=file on overlay rows and panel recents; search hits carry source.absPath (fn-119.2); peek recents carry absPath; browsed rows derive it (fn-120.8). The gap this task closes: no-absPath rows currently just disable file-open — R11 requires the web fallback and, failing that, explicit guidance. Never start gno serve from the plugin.

## Acceptance
- [ ] Enter on every row type (overlay recents, search hits, browsed docs; panel recents) opens the document live — a real window/tab appeared and was captured per row type.
- [ ] Rows without absPath fall back to the web UI deep link when serve runs; with serve down they show explicit guidance instead of a silent no-op.
- [ ] Explicit web-open key still works on every row type; opener failures remain non-blocking notices.
- [ ] README documents the full open matrix.
- [ ] Installed from the local checkout onto the live Omarchy session with captured evidence per row type including the fallback and guidance paths.


## Done summary
Enter-opens-everywhere shipped (R11). Single openDocument(row) entry now backs Enter on every doc row (overlay recents/search/browse, panel recents): absPath present-or-joinable -> file open via existing trampoline; no absPath + serve.running -> web deep link with brief Opened-in-web-UI status; no absPath + serve down -> explicit guidance notice (No file path - start gno serve --detach to open in the web UI), never a silent no-op, plugin never starts serve. Ctrl+Enter/w remain explicit web-open. Audit found the prior behavior disabled file-open on absPath-less rows without opening anything - all such paths now route through openDocument. Carried-over P2 fixed: browse and Load-more rows render their path/hint exactly once (snippet cleared, metaText authoritative). Live evidence: real Typora windows for recents/search/browse/panel opens (browse via joined absPath), Chromium loading the /doc?uri= deep link for the fallback with serve up, guidance notice with zero spawn with serve down, explicit web paths verified. Gates: validate 0, qmllint 0. Serve stopped; session restored ready/1673/22, opener xdg-open.
## Evidence
- Commits: 3d1c778
- Tests: omarchy plugin validate ., qmllint -I /usr/share/omarchy/shell, live QA /tmp/fn-120.9-qa (open-recents/open-search/open-browse/open-panel/fallback-web/guidance/explicit-web/browse-rows-fixed)
- PRs: