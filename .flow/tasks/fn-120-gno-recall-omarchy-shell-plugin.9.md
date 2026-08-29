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
TBD

## Evidence
- Commits:
- Tests:
- PRs:
