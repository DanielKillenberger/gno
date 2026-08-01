import { expect, test } from "bun:test";

import homepage from "../../src/serve/public/index.html";
import { createSpaBundleSource } from "../../src/serve/spa-bundle-source";

test("private SPA bundle source serves entry and generated assets", async () => {
  const source = createSpaBundleSource(homepage, false);
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
