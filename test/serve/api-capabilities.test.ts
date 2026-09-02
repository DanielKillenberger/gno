import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../../src/config/types";
import type { ServerContext } from "../../src/serve/context";
import type { RequestPeerServer } from "../../src/serve/request-locality";
import type { ContextHolder } from "../../src/serve/routes/api";
import type { DocumentRow } from "../../src/store/types";

import {
  handleCapabilities,
  handleRevealDoc,
} from "../../src/serve/routes/api";
import { safeRm } from "../helpers/cleanup";

const loopbackPeer: RequestPeerServer = {
  requestIP: () => ({ address: "127.0.0.1", port: 49_152 }),
};

function localRequest(
  url: string,
  method = "GET",
  extraHeaders: Record<string, string> = {}
): Request {
  return new Request(url, {
    method,
    headers: { host: "localhost:3000", ...extraHeaders },
  });
}

function proxiedRequest(url: string, method = "GET"): Request {
  return localRequest(url, method, { "x-forwarded-for": "10.0.0.7" });
}

describe("GET /api/capabilities localClient", () => {
  const ctx = {
    capabilities: { bm25: true, vector: false, hybrid: false, answer: false },
  } as unknown as ServerContext;

  test("reports true for a same-host client", async () => {
    const res = handleCapabilities(
      ctx,
      localRequest("http://localhost:3000/api/capabilities"),
      loopbackPeer
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bm25: true,
      vector: false,
      hybrid: false,
      answer: false,
      localClient: true,
    });
  });

  test("reports false for a proxied client", async () => {
    const res = handleCapabilities(
      ctx,
      proxiedRequest("http://localhost:3000/api/capabilities"),
      loopbackPeer
    );
    const body = (await res.json()) as { localClient: boolean };
    expect(body.localClient).toBe(false);
  });
});

describe("POST /api/docs/:id/reveal locality", () => {
  let tmpDir: string;
  let ctxHolder: ContextHolder;
  let store: {
    getDocumentByDocid: (id: string) => Promise<unknown>;
    getDocumentByUri: (uri: string) => Promise<unknown>;
  };
  let sourcePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gno-reveal-locality-"));
    sourcePath = join(tmpDir, "doc.md");
    await writeFile(sourcePath, "# Hello");
    const config: Config = {
      version: "1.0",
      ftsTokenizer: "unicode61",
      collections: [
        {
          name: "notes",
          path: tmpDir,
          pattern: "**/*.md",
          include: [],
          exclude: [],
        },
      ],
      contexts: [],
    };
    ctxHolder = {
      current: { config } as ContextHolder["current"],
      config,
      scheduler: null,
      eventBus: null,
      watchService: null,
    };
    const now = new Date().toISOString();
    const doc: DocumentRow = {
      id: 1,
      collection: "notes",
      relPath: "doc.md",
      sourceHash: "hash",
      sourceMime: "text/markdown",
      sourceExt: ".md",
      sourceSize: 7,
      sourceMtime: now,
      docid: "#abc123",
      uri: "gno://notes/doc.md",
      title: "Doc",
      mirrorHash: "mirror",
      converterId: null,
      converterVersion: null,
      languageHint: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      active: true,
      ingestVersion: null,
      createdAt: now,
      updatedAt: now,
    };
    store = {
      getDocumentByDocid: (id: string) =>
        Promise.resolve({ ok: true, value: id === doc.docid ? doc : null }),
      getDocumentByUri: (uri: string) =>
        Promise.resolve({ ok: true, value: uri === doc.uri ? doc : null }),
    };
  });

  afterEach(async () => {
    await safeRm(tmpDir);
  });

  test("refuses a non-local client with 403 before revealing", async () => {
    let revealed = 0;
    const res = await handleRevealDoc(
      ctxHolder,
      store as never,
      "#abc123",
      proxiedRequest("http://localhost:3000/api/docs/%23abc123/reveal", "POST"),
      {
        revealFilePath: async () => {
          revealed += 1;
        },
        server: loopbackPeer,
      }
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Reveal is only available to a local client",
      },
    });
    expect(revealed).toBe(0);
  });

  test("refuses a request without a peer server", async () => {
    const res = await handleRevealDoc(
      ctxHolder,
      store as never,
      "#abc123",
      localRequest("http://localhost:3000/api/docs/%23abc123/reveal", "POST"),
      { revealFilePath: async () => undefined }
    );
    expect(res.status).toBe(403);
  });

  test("reveals for a local client", async () => {
    let revealedPath = "";
    const res = await handleRevealDoc(
      ctxHolder,
      store as never,
      "#abc123",
      localRequest("http://localhost:3000/api/docs/%23abc123/reveal", "POST"),
      {
        revealFilePath: async (path) => {
          revealedPath = path;
        },
        server: loopbackPeer,
      }
    );
    expect(res.status).toBe(200);
    expect(revealedPath).toBe(sourcePath);
  });
});
