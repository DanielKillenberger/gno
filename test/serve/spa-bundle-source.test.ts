import { expect, test } from "bun:test";

import homepage from "../../src/serve/public/index.html";
import {
  acceptsGzip,
  createPublicFetchFallback,
  isHashedSpaChunkPath,
  SPA_CHUNK_CACHE_CONTROL,
} from "../../src/serve/server";
import { createSpaBundleSource } from "../../src/serve/spa-bundle-source";
import {
  getProductionSpaAssets,
  loadEmbeddedProductionSpa,
} from "../../src/serve/spa-production";
import {
  buildProductionSpaAssets,
  ROOT_MOUNT_MARKER,
} from "../../src/serve/spa-production-build";
import fixture from "./fixtures/spa-bundle-entry.html";

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
    expect(firstJsText.includes(ROOT_MOUNT_MARKER)).toBe(true);
    expect(html.includes("<base")).toBe(false);

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
  // Dedicated fixture, not the production homepage. Full-suite runs mock
  // SPA modules (use-api, etc.); compiling index.html in that process
  // yields HTTP 500. This bundle only proves the private source surface.
  const source = await createSpaBundleSource(fixture, false);
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

test("production serve assets load the committed snapshot without Bun.build", async () => {
  const originalBuild = Bun.build;
  let buildCalls = 0;
  const stubBuild = (async (
    ...args: Parameters<typeof Bun.build>
  ): Promise<Awaited<ReturnType<typeof Bun.build>>> => {
    buildCalls += 1;
    return originalBuild(...args);
  }) as typeof Bun.build;
  Bun.build = stubBuild;
  try {
    const [served, embedded] = await Promise.all([
      getProductionSpaAssets(),
      loadEmbeddedProductionSpa(),
    ]);
    expect(buildCalls).toBe(0);
    expect(served.html).toBe(embedded.html);
    expect(Object.keys(served.files)).toEqual(Object.keys(embedded.files));
    expect(served.html.includes('id="root"')).toBe(true);
    expect(served.html.includes(ROOT_MOUNT_MARKER)).toBe(false);
    const firstJsPath = served.html.match(/src="(\/[^"]+\.js)"/u)?.[1];
    expect(firstJsPath).toBeTruthy();
    expect(
      firstJsPath !== undefined &&
        served.files[firstJsPath]?.text.includes(ROOT_MOUNT_MARKER)
    ).toBe(true);
  } finally {
    Bun.build = originalBuild;
  }
});

test("hashed chunk path and Accept-Encoding predicates", () => {
  const pathCases: Array<[string, boolean]> = [
    ["/chunk-qg68dnsr.js", true],
    ["/chunk-2874my12.css", true],
    ["/__gno_spa_abc123", false],
    ["/chunk-qg68dnsr.js.map", false],
    ["/api/doc-asset", false],
    ["/vendor/pdfjs/pdf.worker.min.mjs", false],
  ];
  for (const [pathname, expected] of pathCases) {
    expect(isHashedSpaChunkPath(pathname)).toBe(expected);
  }
  const encodingCases: Array<[string | null, boolean]> = [
    [null, false],
    ["", false],
    ["gzip", true],
    ["GZIP, deflate", true],
    ["deflate, br", false],
    ["gzip;q=0", false],
    ["gzip;q=0.5, br", true],
    ["x-gzip", true],
    ["*", false],
  ];
  for (const [header, expected] of encodingCases) {
    expect(acceptsGzip(header)).toBe(expected);
  }
});

test("public fallback serves hashed chunks gzip + immutable, identity on demand, HTML untouched", async () => {
  const source = await createSpaBundleSource(homepage, false);
  const originalGzip = Bun.gzipSync;
  let gzipCalls = 0;
  Bun.gzipSync = ((...args: Parameters<typeof Bun.gzipSync>) => {
    gzipCalls += 1;
    return originalGzip(...args);
  }) as typeof Bun.gzipSync;
  // Same factory server.ts mounts on the public listener; real TCP so the
  // browser-side Accept-Encoding header actually crosses the wire.
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createPublicFetchFallback({ isDev: false, spaBundleSource: source }),
  });
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    const entry = await source.fetch(
      new Request(`http://public.invalid${source.entryPath}`)
    );
    const html = await entry.text();
    const chunkPath = html.match(/src="(\/chunk-[a-z0-9]+\.js)"/u)?.[1];
    expect(chunkPath).toBeTruthy();
    const identityText = await (
      await source.fetch(new Request(`http://public.invalid${chunkPath}`))
    ).text();

    // gzip-accepting client
    const gz = await fetch(`${origin}${chunkPath}`, {
      decompress: false,
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(gz.status).toBe(200);
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    expect(gz.headers.get("vary")).toBe("Accept-Encoding");
    expect(gz.headers.get("cache-control")).toBe(SPA_CHUNK_CACHE_CONTROL);
    expect(gz.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(gz.headers.get("content-type")).toContain("javascript");
    expect(gz.headers.get("content-security-policy")).toBeTruthy();
    const gzBytes = new Uint8Array(await gz.arrayBuffer());
    expect(gz.headers.get("content-length")).toBe(String(gzBytes.byteLength));
    expect(gzBytes.byteLength).toBeLessThan(identityText.length);
    expect(new TextDecoder().decode(Bun.gunzipSync(gzBytes))).toBe(
      identityText
    );
    expect(gzipCalls).toBe(1);

    // computed once per pathname: GET again and HEAD reuse the cached body
    const again = await fetch(`${origin}${chunkPath}`, {
      decompress: false,
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    });
    expect(again.status).toBe(200);
    expect(again.headers.get("content-encoding")).toBe("gzip");
    expect((await again.arrayBuffer()).byteLength).toBe(gzBytes.byteLength);
    const head = await fetch(`${origin}${chunkPath}`, {
      method: "HEAD",
      decompress: false,
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-encoding")).toBe("gzip");
    expect(head.headers.get("content-length")).toBe(String(gzBytes.byteLength));
    expect(head.headers.get("cache-control")).toBe(SPA_CHUNK_CACHE_CONTROL);
    expect(await head.text()).toBe("");
    expect(gzipCalls).toBe(1);

    // identity client: original bytes, same cache headers
    for (const acceptEncoding of [undefined, "identity", "gzip;q=0"]) {
      const plain = await fetch(`${origin}${chunkPath}`, {
        decompress: false,
        headers: acceptEncoding
          ? { "Accept-Encoding": acceptEncoding }
          : { "Accept-Encoding": "" },
      });
      expect(plain.status).toBe(200);
      expect(plain.headers.get("content-encoding")).toBeNull();
      expect(plain.headers.get("vary")).toBe("Accept-Encoding");
      expect(plain.headers.get("cache-control")).toBe(SPA_CHUNK_CACHE_CONTROL);
      const plainText = await plain.text();
      expect(plainText).toBe(identityText);
      expect(plain.headers.get("content-length")).toBe(
        String(new TextEncoder().encode(identityText).byteLength)
      );
    }
    expect(gzipCalls).toBe(1);

    // entry HTML keeps its headers: no encoding, no immutable policy
    const entryPublic = await fetch(`${origin}${source.entryPath}`, {
      decompress: false,
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(entryPublic.status).toBe(200);
    expect(entryPublic.headers.get("content-type")).toContain("text/html");
    expect(entryPublic.headers.get("content-encoding")).toBeNull();
    expect(entryPublic.headers.get("cache-control")).toBeNull();
    expect(entryPublic.headers.get("vary")).toBeNull();
    expect(await entryPublic.text()).toBe(html);

    // unknown path still 404s through the fallback
    const missing = await fetch(`${origin}/chunk-doesnotexist.js`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-encoding")).toBeNull();
  } finally {
    Bun.gzipSync = originalGzip;
    await server.stop(true);
    await source.close();
  }
});

test("production SPA build refuses a bunfs HTML entry", async () => {
  let thrown: unknown;
  try {
    await buildProductionSpaAssets("/$bunfs/root/index-eenebfbp.html");
  } catch (error) {
    thrown = error;
  }
  expect(thrown instanceof Error && /bunfs/.test(thrown.message)).toBe(true);
});
