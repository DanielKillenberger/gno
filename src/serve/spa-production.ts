import productionSpaGzip from "../../assets/spa-production.json.gz" with { type: "file" };
import {
  buildProductionSpaAssets,
  isStandaloneExecutable,
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
    if (isStandaloneExecutable()) {
      return loadEmbeddedProductionSpa();
    }
    return buildProductionSpaAssets();
  };
