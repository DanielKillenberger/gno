import { expect, test } from "bun:test";

import { createSpaBundleSource } from "../../src/serve/spa-bundle-source";
import fixture from "./fixtures/spa-bundle-entry.html";

test("private SPA bundle source serves entry and generated assets", async () => {
  // Dedicated fixture, not the production homepage. Full-suite runs mock
  // SPA modules (use-api, etc.); compiling index.html in that process
  // yields HTTP 500. This bundle only proves the private source surface.
  const source = createSpaBundleSource(fixture, false);
  try {
    const entry = await source.fetch(
      new Request(`http://public.invalid${source.entryPath}`)
    );
    expect(entry.status).toBe(200);
    const html = await entry.text();
    expect(html).toContain('<div id="root"></div>');

    const assetPath = html.match(/(?:src|href)="(\/[^"]+)"/u)?.[1];
    expect(assetPath).toBeTruthy();
    const asset = await source.fetch(
      new Request(`http://public.invalid${assetPath}`)
    );
    expect(asset.status).toBe(200);
    expect((await asset.arrayBuffer()).byteLength).toBeGreaterThan(0);
  } finally {
    await source.close();
  }
});
