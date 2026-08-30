/**
 * Prebuild the production WebUI SPA into assets/spa-production.json.gz.
 *
 * Source-run `gno serve` rebuilds from `src/serve/public/index.html`.
 * `bun build --compile` binaries cannot call Bun.build on /$bunfs, so they
 * serve this embedded snapshot instead.
 */

import { join } from "node:path";

import { buildProductionSpaAssets } from "../src/serve/spa-production-build";

const repoRoot = join(import.meta.dir, "..");
const outPath = join(repoRoot, "assets", "spa-production.json.gz");

const assets = await buildProductionSpaAssets();
const json = JSON.stringify(assets);
const gzip = Bun.gzipSync(json);
await Bun.write(outPath, gzip);
console.log(
  `Wrote ${outPath} (${gzip.byteLength} bytes gzip, ${json.length} bytes json, ${Object.keys(assets.files).length} files)`
);
