import type { HTMLBundle, Server } from "bun";

// node:fs/promises — no Bun equivalent for mkdir/rm/unlink of sockets and build dirs.
import { mkdir, rm, unlink } from "node:fs/promises";
// node:os — no Bun equivalent for the platform temporary directory.
import { tmpdir } from "node:os";
// node:path — no Bun path utils.
import { basename, join } from "node:path";

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
 * Production (`isDev === false`) builds the HTML entry with `Bun.build`
 * splitting so the document references an external first JS module plus extra
 * chunks instead of one inlined ~11.8 MB script. Development keeps the live
 * HTMLBundle so HMR still works.
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

  return createSplitProductionSource(bundle, entryPath, nonce);
}

async function createSplitProductionSource(
  bundle: HTMLBundle,
  entryPath: string,
  nonce: string
): Promise<SpaBundleSource> {
  const outdir = join(tmpdir(), `gno-spa-build-${nonce.slice(0, 20)}`);
  await mkdir(outdir, { recursive: true });

  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [bundle.index],
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

  const htmlArtifact = result.outputs.find((output) =>
    output.path.endsWith(".html")
  );
  if (!htmlArtifact) {
    await rm(outdir, { recursive: true, force: true });
    throw new Error("Production SPA split build did not emit HTML");
  }

  const html = await htmlArtifact.text();
  const files = new Map<string, ReturnType<typeof Bun.file>>();
  for (const output of result.outputs) {
    if (output.path.endsWith(".html")) {
      continue;
    }
    files.set(`/${basename(output.path)}`, Bun.file(output.path));
  }

  const resolve = (pathname: string): Response => {
    if (pathname === entryPath) {
      return new Response(html, {
        headers: { "Content-Type": "text/html;charset=utf-8" },
      });
    }
    const file = files.get(pathname);
    if (!file) {
      return notFound();
    }
    return new Response(file);
  };

  const source = await hostPrivateSource({
    entryPath,
    fetchAsset: resolve,
    isDev: false,
    nonce,
  });

  return {
    close: async (): Promise<void> => {
      await source.close();
      await rm(outdir, { recursive: true, force: true });
    },
    entryPath: source.entryPath,
    fetch: (request) => source.fetch(request),
  };
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
