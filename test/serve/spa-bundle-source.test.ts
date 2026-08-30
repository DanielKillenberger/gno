import { expect, test } from "bun:test";

import homepage from "../../src/serve/public/index.html";
import { createSpaBundleSource } from "../../src/serve/spa-bundle-source";

const DOCUMENT_ASSET_RE = /<(?:script|link)\b[^>]*\b(?:src|href)="(\/[^"]+)"/gu;
const CHUNK_HREF_RE = /\/chunk-[a-z0-9]+\.js/g;
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>/u;
const MONOLITH_JS_BYTES = 8_000_000;

const documentAssetPaths = (html: string): string[] => {
  const paths: string[] = [];
  for (const match of html.matchAll(DOCUMENT_ASSET_RE)) {
    const path = match[1];
    if (path) {
      paths.push(path);
    }
  }
  return paths;
};

test("production SPA source emits a split first JS file plus extra chunks", async () => {
  const source = await createSpaBundleSource(homepage, false);
  try {
    const entry = await source.fetch(
      new Request(`http://public.invalid${source.entryPath}`)
    );
    expect(entry.status).toBe(200);
    const html = await entry.text();
    expect(html).toContain('<div id="root"></div>');
    expect(INLINE_SCRIPT_RE.test(html)).toBe(false);

    const assets = documentAssetPaths(html);
    const firstJsPath = assets.find((path) => path.endsWith(".js"));
    expect(firstJsPath).toBeTruthy();
    expect(assets.filter((path) => path.endsWith(".js")).length).toBe(1);

    for (const assetPath of assets) {
      const asset = await source.fetch(
        new Request(`http://public.invalid${assetPath}`)
      );
      expect(asset.status).toBe(200);
      expect((await asset.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }

    const firstJs = await source.fetch(
      new Request(`http://public.invalid${firstJsPath}`)
    );
    expect(firstJs.status).toBe(200);
    const firstJsText = await firstJs.text();
    expect(firstJsText.length).toBeLessThan(MONOLITH_JS_BYTES);

    const extraChunks = [
      ...new Set(firstJsText.match(CHUNK_HREF_RE) ?? []),
    ].filter((path) => path !== firstJsPath);
    expect(extraChunks.length).toBeGreaterThan(0);

    const extra = await source.fetch(
      new Request(`http://public.invalid${extraChunks[0]}`)
    );
    expect(extra.status).toBe(200);
    expect((await extra.arrayBuffer()).byteLength).toBeGreaterThan(0);
  } finally {
    await source.close();
  }
});

test("private SPA bundle source serves entry and generated assets", async () => {
  const source = await createSpaBundleSource(homepage, false);
  try {
    const entry = await source.fetch(
      new Request(`http://public.invalid${source.entryPath}`)
    );
    expect(entry.status).toBe(200);
    const html = await entry.text();
    expect(html).toContain('<div id="root"></div>');

    const assets = documentAssetPaths(html);
    expect(assets.length).toBeGreaterThan(0);
    for (const assetPath of assets) {
      const asset = await source.fetch(
        new Request(`http://public.invalid${assetPath}`)
      );
      expect(asset.status).toBe(200);
      expect((await asset.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  } finally {
    await source.close();
  }
});
