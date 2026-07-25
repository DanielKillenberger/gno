import { describe, expect, mock, test } from "bun:test";

import {
  MAX_HTTP_DESTINATION_REDIRECTS,
  type HttpDestinationResolver,
  type PinnedHttpFetch,
  PinnedHttpRequestError,
  prepareHttpDestination,
} from "../../src/llm/http-policy";

function sequenceResolver(
  ...answers: Array<readonly string[]>
): HttpDestinationResolver {
  let index = 0;
  return {
    lookup(): Promise<readonly string[]> {
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return Promise.resolve(answer ?? []);
    },
  };
}

function expectSanitizedError(error: unknown): void {
  expect(error).toBeInstanceOf(PinnedHttpRequestError);
  expect(error).toMatchObject({
    code: "PINNED_HTTP_REQUEST_FAILED",
    message: "Pinned HTTP request failed",
    aborted: false,
  });
  const exposedError = `${JSON.stringify(error)}\n${
    error instanceof Error ? error.stack : ""
  }`;
  for (const secret of [
    "10.0.0.2",
    "errors.internal",
    "private/path",
    "token",
    "secret",
    "user",
    "password",
  ]) {
    expect(exposedError).not.toContain(secret);
  }
}

describe("pinned HTTP boundary projections", () => {
  test("keeps redirect enforcement independent from mutable projections", async () => {
    const prepared = await prepareHttpDestination("https://public.example/v1", {
      maximumZone: "remote",
      resolver: sequenceResolver(["8.8.8.8"], ["10.0.0.2"]),
      env: {},
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(Object.isFrozen(prepared.value.classification)).toBe(true);
    expect(Object.isFrozen(prepared.value.classification.audit)).toBe(true);
    expect(
      Object.isFrozen(prepared.value.classification.audit.addressClasses)
    ).toBe(true);
    expect(Reflect.set(prepared.value.classification, "zone", "lan")).toBe(
      false
    );
    expect(
      Reflect.set(prepared.value.toJSON().classification, "zone", "lan")
    ).toBe(false);

    expect(
      await prepared.value.followRedirect("https://private.example/v1")
    ).toMatchObject({
      ok: false,
      reason: "REDIRECT_ZONE_CHANGED",
    });
  });

  test("normalizes fetch failures without leaking the pinned target", async () => {
    const prepared = await prepareHttpDestination(
      "https://errors.internal/private/path?token=secret",
      {
        maximumZone: "lan",
        resolver: sequenceResolver(["10.0.0.2"], ["10.0.0.2"]),
        env: {},
      }
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const acquired = await prepared.value.acquireConnection();
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;

    let caught: unknown;
    try {
      await acquired.value.request({}, async (input) => {
        const target =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        throw new Error(`raw fetch failure: ${target}; user:password`);
      });
    } catch (error) {
      caught = error;
    }

    expectSanitizedError(caught);
  });

  test("allowlists request init and force-disables fetch diagnostics", async () => {
    const prepared = await prepareHttpDestination(
      "https://errors.internal/private/path?token=secret",
      {
        maximumZone: "lan",
        resolver: sequenceResolver(["10.0.0.2"], ["10.0.0.2"]),
        env: {},
      }
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const acquired = await prepared.value.acquireConnection();
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;

    let observedInit: BunFetchRequestInit | undefined;
    const fetchSpy: PinnedHttpFetch = async (_input, init) => {
      observedInit = init;
      return new Response("ok");
    };
    const hostileInit = {
      body: "payload",
      debug: true,
      diagnostics: true,
      method: "POST",
      proxy: "http://user:password@attacker.proxy:8080",
      s3: { accessKeyId: "user", secretAccessKey: "secret" },
      unix: "/private/path/socket",
      verbose: true,
    } as BunFetchRequestInit & {
      debug: boolean;
      diagnostics: boolean;
    };
    const response = await acquired.value.request(hostileInit, fetchSpy);

    expect(await response.text()).toBe("ok");
    expect(observedInit).toMatchObject({
      body: "payload",
      method: "POST",
      redirect: "manual",
      verbose: false,
    });
    const observedRecord = observedInit as Record<string, unknown>;
    for (const stripped of ["debug", "diagnostics", "proxy", "s3", "unix"]) {
      expect(observedRecord[stripped]).toBeUndefined();
    }
  });

  test("normalizes late response body read and cancellation failures", async () => {
    const prepared = await prepareHttpDestination(
      "https://errors.internal/private/path?token=secret",
      {
        maximumZone: "lan",
        resolver: sequenceResolver(["10.0.0.2"], ["10.0.0.2"], ["10.0.0.2"]),
        env: {},
      }
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const acquired = await prepared.value.acquireConnection();
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;

    const leakingMessage =
      "https://10.0.0.2/private/path?token=secret user:password";
    const readResponse = await acquired.value.request({}, async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error(leakingMessage));
        },
      });
      return new Response(body);
    });
    let readError: unknown;
    try {
      await readResponse.text();
    } catch (error) {
      readError = error;
    }
    expectSanitizedError(readError);

    const cancelResponse = await acquired.value.request({}, async () => {
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          throw new Error(leakingMessage);
        },
      });
      return new Response(body);
    });
    let cancelError: unknown;
    try {
      await cancelResponse.body?.cancel();
    } catch (error) {
      cancelError = error;
    }
    expectSanitizedError(cancelError);
  });

  test("rejects invalid and excessive redirect counts before resolution", async () => {
    const lookup = mock(() => Promise.resolve(["8.8.8.8"]));
    const invalidCounts = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    const invalidResults = [];
    for (const redirectCount of invalidCounts) {
      const result = await prepareHttpDestination(
        "https://secret.example/private/path?token=secret",
        {
          maximumZone: "remote",
          redirectCount,
          resolver: { lookup },
          env: {},
        }
      );
      expect(result).toMatchObject({
        ok: false,
        reason: "INVALID_REDIRECT_COUNT",
        audit: { redirectCount: 0 },
      });
      invalidResults.push(JSON.stringify(result));
    }
    expect(new Set(invalidResults).size).toBe(1);

    const excessive = await prepareHttpDestination(
      "https://secret.example/private/path?token=secret",
      {
        maximumZone: "remote",
        redirectCount: MAX_HTTP_DESTINATION_REDIRECTS + 1,
        resolver: { lookup },
        env: {},
      }
    );
    expect(excessive).toMatchObject({
      ok: false,
      reason: "REDIRECT_LIMIT",
      audit: { redirectCount: MAX_HTTP_DESTINATION_REDIRECTS + 1 },
    });
    expect(lookup).not.toHaveBeenCalled();
    const serialized = JSON.stringify({ invalidResults, excessive });
    for (const secret of [
      "secret.example",
      "private/path",
      "token",
      "secret",
      "8.8.8.8",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("omits credentials, hostnames, paths, and addresses from denials", async () => {
    const credentialed = await prepareHttpDestination(
      "https://user:password@secret.example/private/path?api_key=token",
      {
        maximumZone: "remote",
        resolver: sequenceResolver(["8.8.8.8"]),
        env: {},
      }
    );
    const serialized = JSON.stringify(credentialed);
    for (const secret of [
      "user",
      "password",
      "secret.example",
      "private/path",
      "api_key",
      "8.8.8.8",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
