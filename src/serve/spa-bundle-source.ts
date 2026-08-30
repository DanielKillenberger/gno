import type { HTMLBundle, Server } from "bun";

// node:fs/promises — no Bun equivalent for unlink of private sockets.
import { unlink } from "node:fs/promises";
// node:os — no Bun equivalent for the platform temporary directory.
import { tmpdir } from "node:os";
// node:path — no Bun path utils.
import { join } from "node:path";

import {
  getProductionSpaAssets,
  type ProductionSpaAssets,
} from "./spa-production";

type BunServer = Server<unknown>;

export type SpaBundleSource = {
  entryPath: string;
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
};

const notFound = (): Response => new Response("Not Found", { status: 404 });

const isEnoent = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );

/**
 * Host Bun's headerless HTML / asset surface outside the public listener.
 *
 * Unix hosts use a private Unix-domain socket, so the raw bundle and generated
 * assets have no TCP origin at all. Windows falls back to an ephemeral
 * loopback listener plus an unguessable entry path. The public server proxies
 * the bytes and applies its normal security envelope before browser delivery.
 *
 * Production (`isDev === false`) serves a split SPA. Source runs rebuild from
 * `src/serve/public/index.html`. Compiled executables cannot call `Bun.build`
 * on `/$bunfs` (ENOENT on the virtual root), so they serve the prebuilt
 * snapshot embedded from `assets/spa-production.json.gz`. Development keeps
 * the live HTMLBundle so HMR still works.
 */
export async function createSpaBundleSource(
  bundle: HTMLBundle,
  isDev: boolean
): Promise<SpaBundleSource> {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const entryPath = `/__gno_spa_${nonce}`;

  if (isDev) {
    return hostPrivateSource({
      entryPath,
      isDev: true,
      nonce,
      routes: { [entryPath]: bundle },
    });
  }

  return createSplitProductionSource(entryPath, nonce);
}

async function createSplitProductionSource(
  entryPath: string,
  nonce: string
): Promise<SpaBundleSource> {
  const assets = await getProductionSpaAssets();
  return hostProductionAssets(assets, entryPath, nonce);
}

async function hostProductionAssets(
  assets: ProductionSpaAssets,
  entryPath: string,
  nonce: string
): Promise<SpaBundleSource> {
  const resolve = (pathname: string): Response => {
    if (pathname === entryPath) {
      return new Response(assets.html, {
        headers: { "Content-Type": "text/html;charset=utf-8" },
      });
    }
    const file = assets.files[pathname];
    if (!file) {
      return notFound();
    }
    return new Response(file.text, {
      headers: { "Content-Type": file.type },
    });
  };

  return hostPrivateSource({
    entryPath,
    fetchAsset: resolve,
    isDev: false,
    nonce,
  });
}

async function hostPrivateSource(options: {
  entryPath: string;
  fetchAsset?: (pathname: string) => Response;
  isDev: boolean;
  nonce: string;
  routes?: Record<string, HTMLBundle>;
}): Promise<SpaBundleSource> {
  let server: BunServer;
  let fetchPrivate: (request: Request) => Promise<Response>;
  let socketPath: string | null = null;
  const fallback = {
    fetch: (request: Request): Response => {
      if (!options.fetchAsset) {
        return notFound();
      }
      return options.fetchAsset(new URL(request.url).pathname);
    },
  };

  if (process.platform === "win32") {
    server = Bun.serve({
      development: options.isDev,
      hostname: "127.0.0.1",
      port: 0,
      routes: options.routes,
      ...fallback,
    });
    const origin = `http://127.0.0.1:${server.port}`;
    fetchPrivate = async (request): Promise<Response> => {
      const url = new URL(request.url);
      return fetch(`${origin}${url.pathname}${url.search}`, {
        method: request.method,
      });
    };
  } else {
    socketPath = join(tmpdir(), `gno-spa-${options.nonce.slice(0, 20)}.sock`);
    server = Bun.serve({
      development: options.isDev,
      routes: options.routes,
      unix: socketPath,
      ...fallback,
    });
    fetchPrivate = async (request): Promise<Response> => {
      const url = new URL(request.url);
      return fetch(`http://localhost${url.pathname}${url.search}`, {
        method: request.method,
        unix: socketPath ?? undefined,
      });
    };
  }

  let closed = false;
  return {
    close: async (): Promise<void> => {
      if (closed) {
        return;
      }
      closed = true;
      await server.stop(true);
      if (socketPath) {
        try {
          await unlink(socketPath);
        } catch (error) {
          if (!isEnoent(error)) {
            throw error;
          }
        }
      }
    },
    entryPath: options.entryPath,
    fetch: fetchPrivate,
  };
}
