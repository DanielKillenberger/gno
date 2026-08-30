import { expect, test } from "bun:test";

import homepage from "../../src/serve/public/index.html";
import { createSpaBundleSource } from "../../src/serve/spa-bundle-source";

const DOCUMENT_JS_RE = /<script\b[^>]*\bsrc="(\/[^"]+\.js)"/u;
const MONOLITH_JS_BYTES = 8_000_000;
const FORBIDDEN_FIRST_FILE = [
  "pdfjs-dist",
  "react-force-graph-2d",
  "ForceGraph2D",
  "/vendor/pdfjs",
  "createHighlighter",
  "bundledLanguages",
  "source.python",
  "function DocumentEditor",
  "function GraphView",
  "function Ask(",
  "PdfViewer",
];

test("production first JS is a split entry without pdf, graph, or Shiki grammars", async () => {
  const source = await createSpaBundleSource(homepage, false);
  try {
    const entry = await source.fetch(
      new Request(`http://public.invalid${source.entryPath}`)
    );
    expect(entry.status).toBe(200);
    const html = await entry.text();
    const firstJsPath = html.match(DOCUMENT_JS_RE)?.[1];
    expect(firstJsPath).toBeTruthy();

    const firstJs = await source.fetch(
      new Request(`http://public.invalid${firstJsPath}`)
    );
    expect(firstJs.status).toBe(200);
    const firstJsText = await firstJs.text();
    expect(firstJsText.length).toBeLessThan(MONOLITH_JS_BYTES);

    for (const marker of FORBIDDEN_FIRST_FILE) {
      expect(firstJsText.includes(marker)).toBe(false);
    }
  } finally {
    await source.close();
  }
});
