import type { HTMLBundle, Server } from "bun";

// node:fs/promises — no Bun equivalent for removing a Unix socket pathname.
import { unlink } from "node:fs/promises";
// node:os — no Bun equivalent for the platform temporary directory.
import { tmpdir } from "node:os";
// node:path — no Bun equivalent for joining the socket path.
import { join } from "node:path";

type BunServer = Server<unknown>;

export type SpaBundleSource = {
  entryPath: string;
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
};

const notFound = (): Response => new Response("Not Found", { status: 404 });

/**
 * Host Bun's headerless HTMLBundle surface outside the public listener.
 *
 * Unix hosts use a private Unix-domain socket, so the raw bundle and generated
 * assets have no TCP origin at all. Windows falls back to an ephemeral
 * loopback listener plus an unguessable entry path. The public server proxies
 * the bytes and applies its normal security envelope before browser delivery.
 */
export function createSpaBundleSource(
  bundle: HTMLBundle,
  isDev: boolean
): SpaBundleSource {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const entryPath = `/__gno_spa_${nonce}`;
  let server: BunServer;
  let fetchPrivate: (request: Request) => Promise<Response>;
  let socketPath: string | null = null;

  const routes = { [entryPath]: bundle };
  const fallback = { fetch: notFound };

  if (process.platform === "win32") {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      development: isDev,
      routes,
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
    socketPath = join(tmpdir(), `gno-spa-${nonce.slice(0, 20)}.sock`);
    server = Bun.serve({
      unix: socketPath,
      development: isDev,
      routes,
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
    entryPath,
    fetch: fetchPrivate,
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await server.stop(true);
      if (socketPath) {
        try {
          await unlink(socketPath);
        } catch (error) {
          if (
            !error ||
            typeof error !== "object" ||
            !("code" in error) ||
            error.code !== "ENOENT"
          ) {
            throw error;
          }
        }
      }
    },
  };
}
