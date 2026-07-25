import { describe, expect, test } from "bun:test";

import {
  type HttpDestinationResolver,
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

    expect(caught).toBeInstanceOf(PinnedHttpRequestError);
    expect(caught).toMatchObject({
      code: "PINNED_HTTP_REQUEST_FAILED",
      message: "Pinned HTTP request failed",
      aborted: false,
    });
    const exposedError = `${JSON.stringify(caught)}\n${
      caught instanceof Error ? caught.stack : ""
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
