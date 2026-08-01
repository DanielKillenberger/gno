# fn-112 — Hosted-site (`gno.sh`) documentation change brief

**Status: EXTERNAL POST-MERGE OWNER HANDOFF. NOT a completion dependency of
spec `fn-112-native-pdfjs-document-renderer`.**

Nothing in this brief has been applied. The hosted site has **not** been edited,
QA'd, published, or deployed by this engagement, and no claim to the contrary
appears anywhere in this spec's docs, receipts, or task summaries.

## Why this is a brief and not a change

`AGENTS.md` / `CLAUDE.md` require hosted-site docs at `~/work/gno.sh`
(`git@github.com:gmickel/gno.sh.git`) to reflect user-facing changes, and its own
procedure runs deploy + site QA *after* merging to that repo's `main`. This
engagement's authorized scope is **this repository only** — no edit, commit, QA,
deploy, or publication in any other repository. So the work is specified here,
completely, for the owner to apply.

Additionally, `/home/claw/work/gno.sh` **does not exist in this environment**
(`ls -d /home/claw/work/gno.sh` → `No such file or directory`). It was not
cloned, because cloning it is out of scope; the remote is also unreadable from
here (`gh api repos/gmickel/gno.sh` → HTTP 404 for the available credential).
That is the strongest available proof it is untouched.

### How targets are specified — read this before applying

Because the site repo's tree cannot be read from this engagement, this brief
does **not** guess filenames. Guessed paths would be worse than useless: they
look authoritative and silently miss files.

Instead every target is specified as **resolver command + exact anchor string +
literal block or exact substitution**. Run the resolver; it names the file(s).
Locate the anchor; insert or substitute the given text verbatim. No target asks
the applier to judge, adapt, rewrite, summarise, or choose wording — the two
places that would otherwise need discretion (the stale-copy sweep in target 4
and the install page in target 5) are expressed as closed boolean predicates
over exact substrings, with a defined no-op branch. The whole brief is therefore
executable as written, including by a script.

All commands assume `cd ~/work/gno.sh` and `rg` (ripgrep).

## What shipped (the behavior the site must now describe)

1. **Native PDF page rendering in the Web UI.** PDFs open as real rendered
   pages with a selectable, searchable text layer aligned over each page,
   behind a **Pages / Text** toggle. Toolbar: page navigation + page-number
   field, zoom in/out, fixed zoom levels 50%–400%, fit-width, fit-page,
   Download original. Keyboard (page area focused): `PageDown`/`Right` and
   `PageUp`/`Left` change pages, `+`/`-` zoom, `0` resets to 100%; arrows,
   `Home`, `End`, `Space` scroll. Only pages near the viewport render.
2. **Offline-first, no CDN.** PDF.js and its worker, cMaps, and standard fonts
   are served same-origin from the installed `pdfjs-dist` package under
   `/vendor/pdfjs/*`. The CSP gains an explicit `worker-src 'self'`; every
   fetch directive stays `'self'`.
3. **Graceful fallback.** On `corrupt`, `password`, `network`, or `bootstrap`
   failure the viewer switches to the extracted text and shows a notice naming
   the reason plus Download original. With no extracted text either, it shows
   "No extracted text for this document." with a Download original button.
4. **`GET /api/doc-asset`** — original source file bytes, HTTP `Range`
   (`200`/`206`/`416`), `HEAD`, `Accept-Ranges: bytes`,
   `Cache-Control: no-store`, `Content-Disposition: inline`, with
   collection-root containment (`403` on escape). Multi-range is intentionally
   unsupported (`416`).
5. **Known limits.** Printing from the viewer is unsupported (download the
   original). Viewer state (page, zoom, fit mode, Pages/Text) is per visit and
   resets on leaving the document. `globalThis.__gnoPdfMetrics` is an unstable
   local diagnostic surface, **not** an API contract.

## Targets to change

Every target below is: a **resolver command** (deterministic file discovery), an
**anchor** (an exact string to locate), and a **literal block or exact
substitution** to apply. Nothing below asks the applier to judge, adapt,
rewrite, or exercise editorial discretion. Blocks are inserted verbatim.

Two universal rules, applied without exception:

- Resolver returns **no** match → the surface does not exist; record the target
  as a verified no-op and move on.
- Resolver returns **more than one** match → apply to every match. The blocks
  are written to be correct in each.

Markdown heading levels in the blocks below use `####`/`###` as written. If the
resolved file's surrounding section uses a different level, shift every heading
in the inserted block by the same number of levels — this is a mechanical
transformation, not an editorial one, and it is the only permitted alteration
to any block.

### 1. Web UI docs page (the page mirroring this repo's `docs/WEB-UI.md`)

**Resolve:**

```bash
rg -l --glob '!node_modules' 'Read-only Converted Documents|Create editable copy'
```

**Anchor 1a:** the line containing `Create editable copy`.

**Apply 1a:** insert the following block verbatim immediately after the
paragraph containing that anchor.

````markdown
#### Native PDF viewer

PDFs render as actual pages, not just converted text. GNO ships PDF.js and
serves its worker, character maps, and standard fonts same-origin from the
installed package, so page rendering works fully offline with no CDN.

A **Pages / Text** toggle sits at the top of every PDF document view:

- **Pages** — the native viewer: rendered pages with a selectable, searchable
  text layer aligned over each one. The toolbar carries page navigation, a page
  number field, zoom in/out, fixed zoom levels (50%–400%), fit-width and
  fit-page, and **Download original**. With the page area focused, `PageDown` /
  `Right` and `PageUp` / `Left` change pages, `+` / `-` zoom, and `0` resets to
  100%. Arrow-up/down, `Home`, `End`, and `Space` scroll normally. Only pages
  near the viewport are rendered, so long documents stay responsive.
- **Text** — the extracted text that search and the rest of GNO already index.

When a PDF cannot be rendered, GNO switches to the Text view and shows a notice
explaining why, alongside a **Download original** button. There are four
reasons:

| Reason      | Notice             | When                                                 |
| :---------- | :----------------- | :--------------------------------------------------- |
| `corrupt`   | Cannot render      | The file is damaged or not a readable PDF            |
| `password`  | Password protected | The PDF is encrypted and needs a password            |
| `network`   | Could not load     | The bytes could not be fetched in this session       |
| `bootstrap` | Viewer unavailable | PDF.js itself could not start in this browser window |

If the document has no extracted text either, GNO shows **"No extracted text for
this document."** with a **Download original** button instead of an empty pane.

Printing from the viewer is not supported — download the original and print it
from a PDF reader. Viewer state (page, zoom, fit mode, Pages/Text choice) is per
visit and resets when you leave the document.
````

**Anchor 1b:** within the same resolved file(s), the security or CSP block.
Locate with:

```bash
rg -n 'default-src|Content-Security-Policy|Loopback only'
```

**Apply 1b:** if the block is a directive table, insert the row
`` | `worker-src` | `'self'` — the PDF.js module worker | `` matching that
table's column count. If it is a prose or code listing of directives, insert
`worker-src 'self'` into the list. Then insert the following block verbatim
immediately after that block:

````markdown
The PDF.js worker, character maps, and standard fonts are served same-origin
from the installed `pdfjs-dist` package under `/vendor/pdfjs/`, which is what
lets `worker-src` and `font-src` stay at `'self'`. PDF rendering adds no
external network dependency.
````

**Anchor 1c:** `__gnoPdfMetrics`. Locate with:

```bash
rg -n '__gnoPdfMetrics'
```

**Apply 1c:** if there are **zero** matches, this is a verified no-op — do not
introduce the symbol to the site. If there is at least one match, insert this
sentence verbatim immediately after each matching paragraph:

````markdown
`globalThis.__gnoPdfMetrics` is an unstable local diagnostic surface, not an API
contract. It is not versioned and may change or disappear in any release.
````

### 2. API reference page (the page mirroring this repo's `docs/API.md`)

**Resolve:**

```bash
rg -l --glob '!node_modules' '/api/doc/:id/backlinks|/api/capabilities'
```

**Anchor 2a:** the read-operations quick-reference table row whose first cell is
`` `/api/doc` ``.

**Apply 2a:** insert immediately after that row, padded to the table's existing
column widths:

```
| `/api/doc-asset`         | GET    | Get the original source file bytes (Range-capable)          |
```

**Anchor 2b:** the last line of the `Get Document` endpoint section — that is,
the line immediately preceding the next `###` heading after `### Get Document`.

**Apply 2b:** insert the following block verbatim at that point. It is the exact
text landed in this repo's `docs/API.md` in this spec, and it is the endpoint
contract — do not paraphrase, reorder, or drop any status code or header.

`````markdown
### Get Document Asset

```http
GET /api/doc-asset?uri=gno://notes/papers/spec.pdf&path=spec.pdf
```

Streams the **original source file bytes** for an indexed document, rather than
its converted text. The Web UI uses it to feed the native PDF viewer and to
serve "Download original". `HEAD` is supported and returns the identical headers
with an empty body.

**Query Parameters**:

| Param  | Type   | Required    | Description                                                                                  |
| :----- | :----- | :---------- | :------------------------------------------------------------------------------------------- |
| `path` | string | Yes         | Absolute path inside a configured collection, or a path relative to the document's directory |
| `uri`  | string | Conditional | Document URI. Required whenever `path` is relative; ignored when `path` is absolute          |

A relative `path` is resolved against `dirname()` of the file that `uri`
resolves to, then re-checked for containment inside that collection's root. An
absolute `path` must resolve inside one of the configured collection roots.

**Response**: raw file bytes (not JSON), with:

| Header                | Value                                                              |
| :-------------------- | :----------------------------------------------------------------- |
| `Content-Type`        | Detected file type, else `application/octet-stream`                |
| `Content-Length`      | Full size, or the slice length on a `206`                          |
| `Accept-Ranges`       | `bytes`                                                            |
| `Content-Disposition` | `inline; filename*=UTF-8''<encoded basename>`                      |
| `Cache-Control`       | `no-store`                                                         |
| `Content-Range`       | On `206`: `bytes <start>-<end>/<size>`; on `416`: `bytes */<size>` |

**Status Codes**:

| Status | Meaning                                                                                  |
| :----- | :--------------------------------------------------------------------------------------- |
| `200`  | Full body (no `Range` header sent)                                                       |
| `206`  | Single byte range satisfied                                                              |
| `400`  | `VALIDATION` — `path` missing, or `path` relative with no `uri`                          |
| `403`  | `FORBIDDEN` — path escapes the collection root, or is outside all collections            |
| `404`  | `NOT_FOUND` — document, resolved document path, or file on disk not found                |
| `416`  | Unsatisfiable range, or a multi-range request (multi-range is intentionally unsupported) |

**Examples**:

```bash
# Full file
curl "http://localhost:3000/api/doc-asset?uri=gno://notes/papers/spec.pdf&path=spec.pdf" \
  --output spec.pdf

# First 1024 bytes (206 Partial Content)
curl -i -H "Range: bytes=0-1023" \
  "http://localhost:3000/api/doc-asset?uri=gno://notes/papers/spec.pdf&path=spec.pdf"

# Size probe without a body
curl -I "http://localhost:3000/api/doc-asset?uri=gno://notes/papers/spec.pdf&path=spec.pdf"
```

---

### PDF.js Vendor Assets

```http
GET /vendor/pdfjs/pdf.worker.min.mjs
GET /vendor/pdfjs/cmaps/:file
GET /vendor/pdfjs/standard_fonts/:file
```

Serves the pinned `pdfjs-dist` worker, character maps, and standard fonts
**same-origin from the installed package** — GNO never loads PDF.js assets from
a CDN, which is what keeps `worker-src 'self'` and the offline-first guarantee
intact. `GET` and `HEAD` only.

`:file` is a single path segment; `cmaps` accepts `.bcmap` and
`standard_fonts` accepts `.pfb` / `.ttf`. Every resolved path is verified to
live inside the real `pdfjs-dist` package directory, so traversal attempts and
unknown subpaths return `404` rather than escaping it.

| Status | Meaning                                                            |
| :----- | :----------------------------------------------------------------- |
| `200`  | Asset bytes, `Cache-Control: public, max-age=31536000, immutable`  |
| `404`  | `NOT_FOUND` — unknown asset, rejected filename, or missing install |
| `405`  | `METHOD_NOT_ALLOWED` — any method other than `GET` or `HEAD`       |

```bash
curl -I http://localhost:3000/vendor/pdfjs/pdf.worker.min.mjs
```

---
`````

### 3. Web UI product page

**Resolve:**

```bash
rg -l --glob '!node_modules' 'gno serve' \
  | xargs rg -l 'Quick capture|Split-view|knowledge dashboard|Web UI'
```

**Anchor:** the Web UI capability/benefit bullet list — the bullet containing
`editable copy`, or failing that the last bullet in that list.

**Apply:** insert one bullet immediately after the anchor bullet, using the same
bullet marker and indentation as its neighbours, with exactly this text:

```
Native PDF rendering with extracted-text fallback
```

Do not add any other wording. In particular do not claim print support or
persisted viewer state; neither exists.

### 4. Stale "PDF is text-only" claims

This target is a closed, mechanical substitution — not a review sweep.

**Resolve:**

```bash
rg -in --glob '!node_modules' -e 'pdf'
```

**Match predicate (apply the edit to a hit if and only if all three hold):**

1. the line contains `PDF` (case-insensitive), **and**
2. the line contains at least one of these exact substrings (case-insensitive):
   `text extraction`, `extracts text`, `text-extracted`, `converted to
   markdown`, `converts to markdown`, `text only`, `text-only`, **and**
3. the line does **not** contain any of `render`, `renders`, `rendering`,
   `viewer` (case-insensitive).

A hit failing any of the three conditions is a **no-op**. Do not edit it.

**Apply (to matching hits only):** append the following text verbatim to the end
of the **matched line**, preserving that line's existing trailing punctuation.
The unit of edit is the line returned by `rg`, so the boundary is exact and
requires no sentence parsing:

```
 GNO also renders PDF pages natively in the Web UI, so PDFs are not text-only.
```

(Note the single leading space, so it separates from the preceding text.)

Record the counts: total `pdf` hits examined, hits matching the predicate, and
hits edited. Those three numbers are the evidence for this target.

### 5. Install page

**Resolve:**

```bash
rg -l --glob '!node_modules' -e 'npm install' -e 'bun install' -e 'Installation'
```

**Match predicate:** the resolved file contains at least one of the exact
substrings in the left column below (case-insensitive).

**Apply:** if the predicate is **false** — which is the expected outcome — this
target is a verified no-op; record it as such and close it. `pdfjs-dist` is an
ordinary pinned dependency of the published package: no extra install step, no
native build, no new network requirement, so no install instruction changes.

If the predicate is **true**, perform an exact substring replacement for every
occurrence, using this closed table. The edit boundary is the matched substring
itself — nothing outside it is touched, so no clause or sentence boundary has to
be inferred:

| Find (case-insensitive)  | Replace with                |
| :----------------------- | :-------------------------- |
| `no PDF viewing`         | `native PDF viewing`        |
| `cannot view PDFs`       | `can view PDFs`             |
| `text-only documents`    | `documents`                 |
| `PDFs are not rendered`  | `PDFs are rendered natively`|

Make no other change to the install page.

## Live QA Gate checklist (run in the site repo, by the owner)

Per this project's Live QA Gate, a green build is **not** a QA pass — drive the
changed pages.

**Before merge**

```bash
cd ~/work/gno.sh
bun run check
bun run typecheck
bun run build
bun run dev      # http://localhost:3344
```

Drive every changed page at `http://localhost:3344`:

- [ ] Web UI docs page — new PDF viewer section renders; headings land in the
      sidebar/TOC; the CSP table renders as a table, not raw pipes
- [ ] API reference — both new sections render; the three `curl` blocks copy
      correctly via the copy button; the `filename*=UTF-8''…` value is not
      mangled by smart quotes
- [ ] Web UI product page — new capability line renders and does not overflow
- [ ] Every page touched by the `rg -in 'pdf'` sweep
- [ ] Navigation and in-page anchors to the new sections resolve (no 404s)
- [ ] Mobile width (≤ 390px): tables scroll or wrap, no horizontal page overflow
- [ ] Capture a screenshot of each changed page as evidence

**After deploy**

```bash
cd ~/work/gno.sh
DEPLOY_HOST=root@178.104.180.89 ./scripts/deploy-prod.sh
curl -fsSI https://gno.sh
ssh root@178.104.180.89 "systemctl is-active gno-sh"
ssh root@178.104.180.89 "cd /srv/gno-sh/repo && git rev-parse --short HEAD"   # must equal origin/main
```

- [ ] Re-drive every changed page on `https://gno.sh` and re-capture screenshots
- [ ] Remote `.env.production` showing in `git status` is expected, not a defect

## Ownership

| Item                                     | Owner                        | Blocking for fn-112? |
| :--------------------------------------- | :--------------------------- | :------------------- |
| This brief existing and being applicable | This spec                    | **Yes** — satisfied  |
| Applying the edits in `gno.sh`           | External post-merge owner    | No                   |
| Site Live QA, deploy, prod verification  | External post-merge owner    | No                   |
