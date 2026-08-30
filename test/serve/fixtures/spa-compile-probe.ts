/**
 * Isolated compiled-executable probe for the production SPA path.
 *
 * Mirrors the completion-review CR-01 probe: import the real HTML entry and
 * call createSpaBundleSource(). A compiled binary must serve the mount entry
 * without calling Bun.build on /$bunfs.
 */

import homepage from "../../../src/serve/public/index.html";
import { createSpaBundleSource } from "../../../src/serve/spa-bundle-source";
import {
  isStandaloneExecutable,
  ROOT_MOUNT_MARKER,
} from "../../../src/serve/spa-production-build";

const DOCUMENT_ASSET_RE = /<(?:script|link)\b[^>]*\b(?:src|href)="(\/[^"]+)"/gu;

const source = await createSpaBundleSource(homepage, false);
try {
  const entry = await source.fetch(
    new Request(`http://public.invalid${source.entryPath}`)
  );
  const html = await entry.text();
  const assets = [...html.matchAll(DOCUMENT_ASSET_RE)]
    .map((match) => match[1])
    .filter((path): path is string => Boolean(path));
  const firstJsPath = assets.find((path) => path.endsWith(".js"));
  if (!firstJsPath) {
    throw new Error("compiled SPA HTML has no first JS file");
  }
  const firstJs = await source.fetch(
    new Request(`http://public.invalid${firstJsPath}`)
  );
  const firstJsText = await firstJs.text();
  const assetStatus: Record<string, number> = {};
  for (const path of assets) {
    const asset = await source.fetch(
      new Request(`http://public.invalid${path}`)
    );
    assetStatus[path] = asset.status;
  }
  console.log(
    JSON.stringify({
      assetStatus,
      bundleIndex: homepage.index,
      entryHasMount: firstJsText.includes(ROOT_MOUNT_MARKER),
      firstJsPath,
      htmlHasRoot: html.includes('<div id="root"></div>'),
      standalone: isStandaloneExecutable(),
    })
  );
} finally {
  await source.close();
}
