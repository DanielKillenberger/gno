import { describe, expect, test } from "bun:test";

import type { Collection } from "../../src/config/types";

import { EgressDeniedError } from "../../src/core/egress-enforcement";
import { NETWORK_BOUNDARY_INVENTORY } from "../../src/core/network-boundary-inventory";
import { requestHttpInference } from "../../src/llm/http-inference";
import {
  enforceHttpMcpEgress,
  httpMcpEgressDeniedResponse,
  MCP_HTTP_EGRESS_TOOLS,
} from "../../src/mcp/http-egress";
import { enforceSyncCommandEgress } from "../../src/mcp/sync-egress";

const sourceFiles = async (): Promise<string[]> => {
  const files: string[] = [];
  for await (const path of new Bun.Glob("src/**/*.ts").scan(".")) {
    files.push(path);
  }
  return files.sort();
};

const pathsMatching = async (pattern: RegExp): Promise<string[]> => {
  const matches: string[] = [];
  for (const path of await sourceFiles()) {
    if (pattern.test(await Bun.file(path).text())) matches.push(path);
    pattern.lastIndex = 0;
  }
  return matches;
};

const inventoryPaths = (marker: string): string[] =>
  [
    ...new Set(
      NETWORK_BOUNDARY_INVENTORY.filter((entry) => entry.marker === marker).map(
        (entry) => entry.path
      )
    ),
  ].sort();

const collection = (
  name: string,
  egressPolicy: Collection["egressPolicy"]
): Collection => ({
  name,
  path: `/${name}`,
  pattern: "**/*",
  include: [],
  exclude: [],
  egressPolicy,
});

describe("network boundary enforcement inventory", () => {
  test("registers every direct fetch callsite", async () => {
    expect(await pathsMatching(/\bfetch\s*\(/u)).toEqual(
      inventoryPaths("fetch")
    );
  });

  test("registers every Bun listener callsite", async () => {
    expect(await pathsMatching(/Bun\.serve/u)).toEqual(
      inventoryPaths("bun_serve")
    );
  });

  test("registers every direct external-process callsite", async () => {
    expect(
      await pathsMatching(/\bspawn\s*\(|\bexecFile\s*\(|Bun\.\$/u)
    ).toEqual(inventoryPaths("external_process"));
  });

  test("registers every HTTP inference adapter", async () => {
    const paths = (await pathsMatching(/\brequestHttpInference\s*\(/u)).filter(
      (path) => path !== "src/llm/http-inference.ts"
    );
    expect(paths).toEqual(inventoryPaths("http_inference"));
  });

  test("requires every registered MCP tool to have an egress content class", async () => {
    const source = await Bun.file("src/mcp/tools/index.ts").text();
    const names = [...new Set(source.match(/"gno_[a-z0-9_]+"/gu) ?? [])].map(
      (name) => name.slice(1, -1)
    );
    expect(names.sort()).toEqual(Object.keys(MCP_HTTP_EGRESS_TOOLS).sort());
  });

  test("documents disabled remote/private paths explicitly", () => {
    const disabled = NETWORK_BOUNDARY_INVENTORY.filter(
      ({ enforcement }) => enforcement === "disabled"
    );
    expect(disabled.map(({ id }) => id).sort()).toEqual([
      "private-agent-access",
      "remote-publish-upload",
    ]);
    expect(disabled.every(({ action }) => action === null)).toBe(true);
  });
});

describe("network boundary policy enforcement", () => {
  test("intersects MCP peer zone authentication and collection policy per request", () => {
    const payload = {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "gno_get",
        arguments: { ref: "gno://notes/private.md" },
      },
    };
    const policies = ["local_only", "lan", "remote"] as const;
    const zones = ["loopback", "lan", "remote"] as const;
    for (const policy of policies) {
      for (const destinationZone of zones) {
        for (const authenticated of [false, true]) {
          const expected =
            destinationZone === "loopback" ||
            (authenticated &&
              (policy === "remote" ||
                (policy === "lan" && destinationZone === "lan")));
          const invoke = () =>
            enforceHttpMcpEgress(payload, [collection("notes", policy)], {
              authenticated,
              destinationZone,
              operationAuthorized: true,
            });
          if (expected) expect(invoke).not.toThrow();
          else expect(invoke).toThrow(EgressDeniedError);
        }
      }
    }
  });

  test("gates resource list and read using the current request zone", () => {
    const collections = [collection("notes", "lan")];
    expect(() =>
      enforceHttpMcpEgress(
        {
          method: "resources/read",
          params: { uri: "gno://notes/private.md" },
        },
        collections,
        {
          authenticated: true,
          destinationZone: "lan",
          operationAuthorized: true,
        }
      )
    ).not.toThrow();
    expect(() =>
      enforceHttpMcpEgress({ method: "resources/list" }, collections, {
        authenticated: true,
        destinationZone: "remote",
        operationAuthorized: true,
      })
    ).toThrow(EgressDeniedError);
  });

  test("attributes a batch denial to the exact denied member", async () => {
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: "gno://notes/private.md" },
      },
    ];
    let denied: EgressDeniedError | undefined;
    try {
      enforceHttpMcpEgress(batch, [collection("notes", "local_only")], {
        authenticated: true,
        destinationZone: "remote",
        operationAuthorized: true,
      });
    } catch (error) {
      if (error instanceof EgressDeniedError) denied = error;
    }
    expect(denied).toBeDefined();
    if (!denied) throw new Error("Expected egress denial");
    const response = httpMcpEgressDeniedResponse(denied, batch);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({
      error: { data: { code: "EGRESS_DENIED" } },
      id: 2,
    });
    expect(JSON.stringify(body)).not.toContain("private.md");
  });

  test("denies unscoped remote inference before DNS or request bytes", async () => {
    let resolverCalls = 0;
    let fetchCalls = 0;
    let denied: unknown;
    try {
      await requestHttpInference(
        "https://provider.example/v1/chat/completions",
        { method: "POST", body: "secret-body" },
        {
          env: {},
          resolver: {
            lookup: async () => {
              resolverCalls += 1;
              return ["93.184.216.34"];
            },
          },
          fetchFn: async () => {
            fetchCalls += 1;
            return new Response("{}");
          },
        }
      );
    } catch (error) {
      denied = error;
    }
    expect(denied).toBeInstanceOf(EgressDeniedError);
    expect(resolverCalls).toBe(0);
    expect(fetchCalls).toBe(0);
  });

  test("supports policy-matched LAN inference through a pinned literal", async () => {
    let requestUrl = "";
    const response = await requestHttpInference(
      "http://192.168.1.20:8080/v1/embeddings",
      { method: "POST", body: "bounded-input" },
      {
        collections: [collection("notes", "lan")],
        env: {},
        fetchFn: async (input) => {
          requestUrl =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          return new Response('{"ok":true}');
        },
      }
    );
    expect(response.ok).toBe(true);
    expect(requestUrl).toStartWith("http://192.168.1.20:8080/");
  });

  test("pins remote inference and refuses cross-origin credential/body forwarding", async () => {
    let fetchCalls = 0;
    const options = {
      collections: [collection("notes", "remote")],
      env: {},
      resolver: {
        lookup: async () => ["93.184.216.34"],
      },
      fetchFn: async () => {
        fetchCalls += 1;
        return new Response(null, {
          status: 307,
          headers: { location: "https://other.example/steal" },
        });
      },
    };
    let denied: unknown;
    try {
      await requestHttpInference(
        "https://provider.example/v1/chat/completions",
        {
          method: "POST",
          headers: { authorization: "Bearer hidden" },
          body: "private-content",
        },
        options
      );
    } catch (error) {
      denied = error;
    }
    expect(denied).toBeInstanceOf(EgressDeniedError);
    expect(fetchCalls).toBe(1);
  });

  test("fails closed on DNS rebinding before inference bytes are sent", async () => {
    let resolverCalls = 0;
    let fetchCalls = 0;
    let denied: unknown;
    try {
      await requestHttpInference(
        "https://provider.example/v1/embeddings",
        { method: "POST", body: "private-content" },
        {
          collections: [collection("notes", "remote")],
          env: {},
          resolver: {
            lookup: async () => {
              resolverCalls += 1;
              return resolverCalls === 1
                ? ["93.184.216.34"]
                : ["93.184.216.35"];
            },
          },
          fetchFn: async () => {
            fetchCalls += 1;
            return new Response("{}");
          },
        }
      );
    } catch (error) {
      denied = error;
    }
    expect(denied).toBeInstanceOf(EgressDeniedError);
    expect(resolverCalls).toBe(2);
    expect(fetchCalls).toBe(0);
  });

  test("requires policy in addition to MCP write authorization for sync commands", () => {
    const ctx = {
      collections: [collection("notes", "local_only")],
      enableWrite: true,
    };
    expect(() =>
      enforceSyncCommandEgress(ctx as never, {
        collectionNames: ["notes"],
        gitPull: true,
      })
    ).toThrow(EgressDeniedError);
  });
});
