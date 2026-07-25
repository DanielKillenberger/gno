import { describe, expect, test } from "bun:test";

import type { ResidentRuntime } from "../../src/serve/resident-runtime";

import { ReaderGate } from "../../src/serve/resident-admission";
import { handleResidentRead } from "../../src/serve/resident-request";

const runtimeHarness = () => {
  let epoch = "egress-epoch-v1:one";
  const runtime = {
    readerGate: new ReaderGate(1, 1),
    admitRequest: () => {
      const requestEpoch = epoch;
      return {
        authorizationEpoch: requestEpoch,
        id: crypto.randomUUID(),
        signal: new AbortController().signal,
        isAuthorizationEpochCurrent: () => requestEpoch === epoch,
        finish: () => undefined,
      };
    },
    withModelLease: async <T>(operation: () => Promise<T>) => operation(),
  } as unknown as ResidentRuntime;
  return {
    runtime,
    rotate: () => {
      epoch = "egress-epoch-v1:two";
    },
  };
};

describe("resident policy epoch response guard", () => {
  test("replaces a delayed stale response with a content-free retry error", async () => {
    const harness = runtimeHarness();
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const responsePromise = handleResidentRead(
      harness.runtime,
      undefined,
      async () => {
        started?.();
        await wait;
        return Response.json({ content: "stale-secret" });
      }
    );
    await didStart;
    harness.rotate();
    release?.();
    const response = await responsePromise;
    expect(response.status).toBe(409);
    const body = await response.text();
    expect(body).toContain("EGRESS_POLICY_CHANGED");
    expect(body).not.toContain("stale-secret");
  });

  test("stops an event stream before emitting a chunk after rotation", async () => {
    const harness = runtimeHarness();
    const response = await handleResidentRead(
      harness.runtime,
      undefined,
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(
                new TextEncoder().encode("data: stale-secret\n\n")
              );
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
    );
    harness.rotate();
    expect(await response.text()).toBe("");
  });
});
