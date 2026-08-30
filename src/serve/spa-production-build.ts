// node:fs/promises — no Bun equivalent for mkdir/rm of the temporary SPA outdir.
import { mkdir, rm } from "node:fs/promises";
// node:os — no Bun equivalent for the platform temporary directory.
import { tmpdir } from "node:os";
// node:path — no Bun path utils.
import { basename, join } from "node:path";

export const ROOT_MOUNT_MARKER = 'getElementById("root")';

export type ProductionSpaFile = {
  text: string;
  type: string;
};

export type ProductionSpaAssets = {
  files: Record<string, ProductionSpaFile>;
  html: string;
};

const SCRIPT_TAG_RE = /<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/iu;
const BASE_TAG_RE = /<base\b[^>]*>/iu;
const CROSSORIGIN_ATTR_RE = /\s+crossorigin(?:=(?:"[^"]*"|'[^']*'))?/gu;

const contentTypeFor = (path: string): string => {
  if (path.endsWith(".css")) {
    return "text/css;charset=utf-8";
  }
  if (path.endsWith(".js")) {
    return "text/javascript;charset=utf-8";
  }
  if (path.endsWith(".map")) {
    return "application/json";
  }
  return "application/octet-stream";
};

export const isStandaloneExecutable = (): boolean =>
  import.meta.path.includes("/$bunfs/") ||
  import.meta.path.includes("\\$bunfs\\");

export const isBunfsPath = (path: string): boolean =>
  path.includes("/$bunfs/") || path.includes("\\$bunfs\\");

export const productionSpaEntryPath = (): string =>
  join(import.meta.dir, "public", "index.html");

const rewriteProductionHtml = (html: string, jsEntryPath: string): string => {
  const script = `<script type="module" src="/${basename(jsEntryPath)}"></script>`;
  let next = html.replace(BASE_TAG_RE, "");
  if (SCRIPT_TAG_RE.test(next)) {
    next = next.replace(SCRIPT_TAG_RE, script);
  } else {
    throw new Error("Production SPA HTML is missing a module script tag");
  }
  return next.replace(CROSSORIGIN_ATTR_RE, "");
};

export const buildProductionSpaAssets = async (
  entryPath: string = productionSpaEntryPath()
): Promise<ProductionSpaAssets> => {
  if (isBunfsPath(entryPath)) {
    throw new Error(
      `Cannot Bun.build a production SPA from bunfs (${entryPath})`
    );
  }

  const outdir = join(
    tmpdir(),
    `gno-spa-build-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`
  );
  await mkdir(outdir, { recursive: true });

  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [entryPath],
      minify: true,
      outdir,
      publicPath: "/",
      splitting: true,
      target: "browser",
    });
  } catch (error) {
    await rm(outdir, { recursive: true, force: true });
    throw error;
  }

  if (!result.success) {
    await rm(outdir, { recursive: true, force: true });
    throw new Error("Production SPA split build failed");
  }

  try {
    const htmlArtifact = result.outputs.find((output) =>
      output.path.endsWith(".html")
    );
    const jsEntry = result.outputs.find(
      (output) => output.kind === "entry-point" && output.path.endsWith(".js")
    );
    if (!htmlArtifact || !jsEntry) {
      throw new Error(
        "Production SPA split build did not emit HTML and JS entry"
      );
    }

    const jsEntryText = await jsEntry.text();
    if (!jsEntryText.includes(ROOT_MOUNT_MARKER)) {
      throw new Error(
        "Production SPA JS entry does not mount #root; HTML would leave the shell blank"
      );
    }

    const html = rewriteProductionHtml(await htmlArtifact.text(), jsEntry.path);
    const files: Record<string, ProductionSpaFile> = {};
    for (const output of result.outputs) {
      if (output.path.endsWith(".html")) {
        continue;
      }
      const publicPath = `/${basename(output.path)}`;
      files[publicPath] = {
        text: await output.text(),
        type: contentTypeFor(output.path),
      };
    }

    return { files, html };
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
};
