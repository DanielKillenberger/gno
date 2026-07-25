import { describe, expect, mock, test } from "bun:test";

import {
  classifyBindDestination,
  classifyDestination,
  classifyNetworkAddress,
} from "../../src/core/destination-classifier";
import {
  MAX_HTTP_DESTINATION_ADDRESSES,
  type HttpDestinationResolver,
  type PinnedHttpFetch,
  prepareHttpDestination,
} from "../../src/llm/http-policy";

function sequenceResolver(
  ...answers: Array<readonly string[] | Error>
): HttpDestinationResolver {
  let index = 0;
  return {
    lookup(): Promise<readonly string[]> {
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer ?? []);
    },
  };
}

async function expectRequestRejection(
  request: Promise<Response>
): Promise<void> {
  let rejected = false;
  try {
    await request;
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}

describe("conservative destination classification", () => {
  test("classifies IPv4, IPv6, private, Tailscale, public, and unsafe ranges", () => {
    const fixtures = [
      ["127.0.0.1", "loopback"],
      ["127.99.1.2", "loopback"],
      ["::1", "loopback"],
      ["::ffff:127.0.0.1", "loopback"],
      ["10.0.0.1", "private"],
      ["172.16.0.1", "private"],
      ["172.31.255.255", "private"],
      ["192.168.1.1", "private"],
      ["fc00::1", "private"],
      ["fe80::1%en0", "private"],
      ["fd7a:115c:a1e0::1", "tailscale"],
      ["fd00:ec2::254", "unknown"],
      ["8.8.8.8", "public"],
      ["2001:4860:4860::8888", "public"],
      ["0.0.0.0", "unknown"],
      ["::", "unknown"],
      ["100.64.0.1", "unknown"],
      ["100.127.255.254", "unknown"],
      ["169.254.169.254", "unknown"],
      ["224.0.0.1", "unknown"],
    ] as const;
    for (const [address, expected] of fixtures) {
      expect(classifyNetworkAddress(address)).toBe(expected);
    }
  });

  test("requires homogeneous DNS proof and never trusts a friendly name", () => {
    expect(
      classifyDestination({ kind: "network", hostname: "localhost" })
    ).toMatchObject({
      zone: "remote",
      addressClass: "unknown",
      reason: "UNPROVEN_REMOTE",
    });
    expect(
      classifyDestination({
        kind: "network",
        hostname: "model.internal",
        addresses: ["10.0.0.2", "10.0.0.3"],
      })
    ).toMatchObject({
      zone: "lan",
      addressClass: "private",
      reason: "PRIVATE_ADDRESS",
    });
    expect(
      classifyDestination({
        kind: "network",
        hostname: "mixed.internal",
        addresses: ["10.0.0.2", "8.8.8.8"],
      })
    ).toMatchObject({
      zone: "remote",
      addressClass: "unknown",
      reason: "MIXED_DNS_ANSWERS",
    });
    expect(
      classifyDestination({
        kind: "network",
        hostname: "mixed-vpn.internal",
        addresses: ["10.0.0.2", "fd7a:115c:a1e0::2"],
      })
    ).toMatchObject({
      zone: "remote",
      reason: "MIXED_DNS_ANSWERS",
    });
  });

  test("IP literals ignore contradictory caller-supplied DNS answers", () => {
    expect(
      classifyDestination({
        kind: "network",
        hostname: "8.8.8.8",
        addresses: ["127.0.0.1"],
      })
    ).toMatchObject({
      zone: "remote",
      addressClass: "public",
    });
  });

  test("classifies explicit bind interfaces without broadening loopback", () => {
    expect(classifyBindDestination("127.0.0.2").zone).toBe("loopback");
    expect(classifyBindDestination("[::1]").zone).toBe("loopback");
    expect(classifyBindDestination("10.1.2.3").zone).toBe("lan");
    expect(classifyBindDestination("0.0.0.0")).toMatchObject({
      zone: "remote",
      reason: "WILDCARD_BIND",
    });
    expect(classifyBindDestination("::")).toMatchObject({
      zone: "remote",
      reason: "WILDCARD_BIND",
    });
    expect(classifyBindDestination("gateway.internal").zone).toBe("remote");
  });

  test("provider identity stays remote and output is stable and redacted", () => {
    const decision = classifyDestination({
      kind: "network",
      hostname: "provider.secret.example",
      addresses: ["93.184.216.34"],
      remoteProvider: true,
    });
    expect(decision).toMatchObject({
      zone: "remote",
      reason: "REMOTE_PROVIDER",
      audit: { source: "provider", addressCount: 1 },
    });
    const serialized = JSON.stringify(decision);
    expect(serialized).not.toContain("provider.secret.example");
    expect(serialized).not.toContain("93.184.216.34");
    expect(serialized).toBe(JSON.stringify(decision));
  });
});

describe("DNS-pinned outbound HTTP policy", () => {
  test("connects to a pinned HTTPS IP while verifying the original DNS certificate", async () => {
    const proxyActive = [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
    ].some((name) => Boolean(process.env[name]?.trim()));
    if (proxyActive) {
      expect(
        await prepareHttpDestination("https://model.test/health", {
          maximumZone: "loopback",
          resolver: sequenceResolver(["127.0.0.1"]),
        })
      ).toMatchObject({
        ok: false,
        reason: "PROXY_ENVIRONMENT_ACTIVE",
      });
      return;
    }

    const cert = await Bun.file(
      `${import.meta.dir}/../fixtures/tls/model.test-cert.pem`
    ).text();
    const key = await Bun.file(
      `${import.meta.dir}/../fixtures/tls/model.test-key.pem`
    ).text();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert, key },
      fetch(request) {
        return Response.json({
          matched: new URL(request.url).pathname === "/private/path",
        });
      },
    });
    try {
      const prepared = await prepareHttpDestination(
        `https://model.test:${server.port}/private/path?api_key=secret`,
        {
          maximumZone: "loopback",
          resolver: sequenceResolver(["127.0.0.1"], ["127.0.0.1"]),
          env: {},
        }
      );
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      const acquired = await prepared.value.acquireConnection();
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;

      const response = await acquired.value.request({ tls: { ca: cert } });
      expect(response.status).toBe(200);
      expect(response.url).toBe("");
      const body = await response.json();
      expect(body).toEqual({ matched: true });
      const exposedResponse = JSON.stringify({
        url: response.url,
        status: response.status,
        headers: [...response.headers],
        body,
      });
      for (const secret of ["127.0.0.1", "private/path", "api_key", "secret"]) {
        expect(exposedResponse).not.toContain(secret);
      }

      const wrongName = await prepareHttpDestination(
        `https://wrong.test:${server.port}/health`,
        {
          maximumZone: "loopback",
          resolver: sequenceResolver(["127.0.0.1"], ["127.0.0.1"]),
          env: {},
        }
      );
      expect(wrongName.ok).toBe(true);
      if (!wrongName.ok) return;
      const wrongConnection = await wrongName.value.acquireConnection();
      expect(wrongConnection.ok).toBe(true);
      if (!wrongConnection.ok) return;

      await expectRequestRejection(
        wrongConnection.value.request({
          tls: {
            ca: cert,
            checkServerIdentity: () => undefined,
            rejectUnauthorized: false,
            serverName: "model.test",
          },
        })
      );

      const previousTlsOverride = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      try {
        await expectRequestRejection(
          wrongConnection.value.request({
            tls: { ca: cert },
          })
        );
      } finally {
        if (previousTlsOverride === undefined) {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        } else {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsOverride;
        }
      }
    } finally {
      await server.stop(true);
    }
  });

  test("pins and rechecks an exact address set before a manual-redirect request", async () => {
    const resolver = sequenceResolver(
      ["10.0.0.3", "10.0.0.2"],
      ["10.0.0.2", "10.0.0.3"]
    );
    const prepared = await prepareHttpDestination(
      "https://models.secret.internal:8443/v1/embed?token=secret",
      { maximumZone: "lan", resolver, env: {} }
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const acquired = await prepared.value.acquireConnection();
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    expect(JSON.stringify(acquired.value)).not.toContain("secret");
    expect(JSON.stringify(acquired.value)).not.toContain("10.0.0");

    let observedUrl = "";
    let observedInit: BunFetchRequestInit | undefined;
    const fetchSpy: PinnedHttpFetch = mock(
      async (
        input: string | URL | Request,
        init?: BunFetchRequestInit
      ): Promise<Response> => {
        observedUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        observedInit = init;
        return new Response(null, { status: 302 });
      }
    );
    const response = await acquired.value.request(
      { redirect: "follow", proxy: "http://attacker.proxy:8080" },
      fetchSpy
    );
    expect(response.status).toBe(302);
    expect(observedUrl).toBe("https://10.0.0.2:8443/v1/embed?token=secret");
    expect(observedInit?.redirect).toBe("manual");
    expect(observedInit?.proxy).toBeUndefined();
    expect(new Headers(observedInit?.headers).get("host")).toBe(
      "models.secret.internal:8443"
    );
    expect(observedInit?.tls?.serverName).toBe("models.secret.internal");
  });

  test("fails closed on rebinding, mixed answers, invalid answers, and DNS overflow", async () => {
    const rebinding = await prepareHttpDestination("http://model.internal/v1", {
      maximumZone: "lan",
      resolver: sequenceResolver(["10.0.0.2"], ["8.8.8.8"]),
      env: {},
    });
    expect(rebinding.ok).toBe(true);
    if (rebinding.ok) {
      expect(await rebinding.value.acquireConnection()).toMatchObject({
        ok: false,
        reason: "DNS_REBINDING",
      });
    }

    const mixed = await prepareHttpDestination("http://model.internal/v1", {
      maximumZone: "lan",
      resolver: sequenceResolver(["10.0.0.2", "8.8.8.8"]),
      env: {},
    });
    expect(mixed).toMatchObject({ ok: false, reason: "ZONE_NOT_ALLOWED" });

    for (const answer of [["garbage"], ["fe80::1%en0"]] as const) {
      expect(
        await prepareHttpDestination("http://model.internal/v1", {
          maximumZone: "remote",
          resolver: sequenceResolver(answer),
          env: {},
        })
      ).toMatchObject({ ok: false, reason: "DNS_INVALID_ANSWER" });
    }

    const excessive = Array.from(
      { length: MAX_HTTP_DESTINATION_ADDRESSES + 1 },
      (_, index) => `10.0.0.${(index % 250) + 1}`
    );
    expect(
      await prepareHttpDestination("http://model.internal/v1", {
        maximumZone: "lan",
        resolver: sequenceResolver(excessive),
        env: {},
      })
    ).toMatchObject({ ok: false, reason: "DNS_RESULT_LIMIT" });
  });

  test("fails restricted requests closed when a process proxy is active", async () => {
    const lookup = mock(() => Promise.resolve(["10.0.0.2"]));
    expect(
      await prepareHttpDestination("http://model.internal/v1", {
        maximumZone: "lan",
        resolver: { lookup },
        env: { HTTPS_PROXY: "http://proxy.internal:8080" },
      })
    ).toMatchObject({
      ok: false,
      reason: "PROXY_ENVIRONMENT_ACTIVE",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  test("rejects provider-to-private resolution and redirect zone changes", async () => {
    expect(
      await prepareHttpDestination("https://provider.example/v1", {
        maximumZone: "remote",
        remoteProvider: true,
        resolver: sequenceResolver(["10.0.0.2"]),
        env: {},
      })
    ).toMatchObject({
      ok: false,
      reason: "PROVIDER_ADDRESS_NOT_PUBLIC",
    });

    const initial = await prepareHttpDestination("https://public.example/v1", {
      maximumZone: "remote",
      resolver: sequenceResolver(["8.8.8.8"], ["10.0.0.2"]),
      env: {},
    });
    expect(initial.ok).toBe(true);
    if (initial.ok) {
      expect(
        await initial.value.followRedirect("https://private.example/v1")
      ).toMatchObject({
        ok: false,
        reason: "REDIRECT_ZONE_CHANGED",
      });
      expect(
        await initial.value.followRedirect("http://public.example/v2")
      ).toMatchObject({
        ok: false,
        reason: "HTTPS_DOWNGRADE",
      });
    }

    const provider = await prepareHttpDestination(
      "https://provider.example/v1",
      {
        maximumZone: "remote",
        remoteProvider: true,
        resolver: sequenceResolver(["8.8.8.8"]),
        env: {},
      }
    );
    expect(provider.ok).toBe(true);
    if (provider.ok) {
      expect(
        await provider.value.followRedirect("https://attacker.example/collect")
      ).toMatchObject({
        ok: false,
        reason: "PROVIDER_REDIRECT_ORIGIN_CHANGED",
      });
    }
  });

  test("requires HTTPS and credential-free URLs for provider requests and redirects", async () => {
    const lookup = mock(() => Promise.resolve(["8.8.8.8"]));
    expect(
      await prepareHttpDestination("http://provider.example/v1", {
        maximumZone: "remote",
        remoteProvider: true,
        resolver: { lookup },
        env: {},
      })
    ).toMatchObject({
      ok: false,
      reason: "PROVIDER_HTTPS_REQUIRED",
    });
    expect(lookup).not.toHaveBeenCalled();

    expect(
      await prepareHttpDestination(
        "https://user:password@provider.example/v1",
        {
          maximumZone: "remote",
          remoteProvider: true,
          resolver: { lookup },
          env: {},
        }
      )
    ).toMatchObject({
      ok: false,
      reason: "CREDENTIALS_IN_URL",
    });
    expect(lookup).not.toHaveBeenCalled();

    const provider = await prepareHttpDestination(
      "https://provider.example/v1",
      {
        maximumZone: "remote",
        remoteProvider: true,
        resolver: sequenceResolver(["8.8.8.8"]),
        env: {},
      }
    );
    expect(provider.ok).toBe(true);
    if (!provider.ok) return;
    expect(
      await provider.value.followRedirect("http://provider.example/v2")
    ).toMatchObject({
      ok: false,
      reason: "HTTPS_DOWNGRADE",
    });
    expect(
      await provider.value.followRedirect(
        "https://user:password@provider.example/v2"
      )
    ).toMatchObject({
      ok: false,
      reason: "CREDENTIALS_IN_URL",
    });
  });
});
