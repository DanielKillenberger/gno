import productionSpaGzip from "../../assets/spa-production.json.gz" with { type: "file" };
import {
  ROOT_MOUNT_MARKER,
  type ProductionSpaAssets,
} from "./spa-production-build";

export {
  buildProductionSpaAssets,
  isBunfsPath,
  isStandaloneExecutable,
  productionSpaEntryPath,
  ROOT_MOUNT_MARKER,
  type ProductionSpaAssets,
  type ProductionSpaFile,
} from "./spa-production-build";

export const loadEmbeddedProductionSpa =
  async (): Promise<ProductionSpaAssets> => {
    const compressed = await Bun.file(productionSpaGzip).arrayBuffer();
    const json = new TextDecoder().decode(
      Bun.gunzipSync(new Uint8Array(compressed))
    );
    const assets = JSON.parse(json) as ProductionSpaAssets;
    const firstJsPath = assets.html.match(/src="(\/[^"]+\.js)"/u)?.[1];
    const firstJs = firstJsPath ? assets.files[firstJsPath] : undefined;
    if (!firstJs?.text.includes(ROOT_MOUNT_MARKER)) {
      throw new Error(
        "Embedded production SPA is missing the #root mount entry"
      );
    }
    return assets;
  };

export const getProductionSpaAssets =
  async (): Promise<ProductionSpaAssets> => {
    // Source and compiled serve both load the committed snapshot. Rebuilding
    // with Bun.build on every `gno serve` blocked first listen on Windows
    // Bun 1.3.11 long enough for the watcher smoke (10s) to miss readiness.
    // Refresh the snapshot with `bun scripts/build-spa-production.ts`.
    // `--dev` keeps the live HTMLBundle. Tests that need a live rebuild call
    // `buildProductionSpaAssets` directly.
    return loadEmbeddedProductionSpa();
  };
