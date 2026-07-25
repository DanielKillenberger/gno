import { describe, expect, test } from "bun:test";

import { DocumentEventBus } from "../../src/serve/doc-events";
import { assertValid, loadSchema } from "../spec/schemas/validator";

describe("DocumentEventBus", () => {
  test("emits a closed metadata-only Capsule reverification event", async () => {
    const bus = new DocumentEventBus();
    const response = bus.createResponse();
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      throw new Error("Expected SSE response body");
    }

    const initial = await reader.read();
    expect(new TextDecoder().decode(initial.value)).toContain(
      "retry: 2000\n: connected"
    );

    bus.emit({
      type: "capsule-reverified",
      registrationId: `capsule-${"a".repeat(40)}`,
      capsuleId: "b".repeat(64),
      operationStatus: "completed",
      affectedQuestionState: "affected",
      changedAt: "2026-07-23T12:00:00.000Z",
    });

    const emitted = await reader.read();
    const frame = new TextDecoder().decode(emitted.value);
    expect(frame.startsWith("event: capsule-reverified\ndata: ")).toBe(true);
    const dataLine = frame
      .split("\n")
      .find((line) => line.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine?.slice("data: ".length) ?? "null");
    expect(Object.keys(payload).sort()).toEqual([
      "affectedQuestionState",
      "capsuleId",
      "changedAt",
      "operationStatus",
      "registrationId",
      "type",
    ]);
    expect(
      assertValid(payload, await loadSchema("capsule-reverified-event"))
    ).toBe(true);

    await reader.cancel();
    expect(bus.getState().connectedClients).toBe(0);
    bus.close();
  });

  test("suppresses document metadata and closes when policy rotates before emit", async () => {
    const bus = new DocumentEventBus();
    let current = true;
    let closed = 0;
    const response = bus.createResponse({
      authorizationEpoch: "epoch-1",
      isAuthorizationEpochCurrent: () => current,
      onClose: () => {
        closed += 1;
      },
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected SSE response body");
    await reader.read();

    current = false;
    bus.emit({
      type: "document-changed",
      uri: "gno://private/secret.md",
      collection: "private",
      relPath: "secret.md",
      origin: "save",
      changedAt: "2026-07-25T08:00:00.000Z",
    });

    const invalidated = await reader.read();
    const frame = new TextDecoder().decode(invalidated.value);
    expect(frame).toContain("EGRESS_POLICY_CHANGED");
    expect(frame).not.toContain("gno://");
    expect(frame).not.toContain("private");
    expect(frame).not.toContain("secret.md");
    expect((await reader.read()).done).toBeTrue();
    expect(bus.getState().connectedClients).toBe(0);
    expect(closed).toBe(1);
  });

  test("rechecks policy on heartbeat before sending a keepalive", async () => {
    const bus = new DocumentEventBus({ keepaliveMs: 1 });
    let current = true;
    const response = bus.createResponse({
      authorizationEpoch: "epoch-1",
      isAuthorizationEpochCurrent: () => current,
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected SSE response body");
    await reader.read();
    current = false;

    const invalidated = await reader.read();
    const frame = new TextDecoder().decode(invalidated.value);
    expect(frame).toContain("EGRESS_POLICY_CHANGED");
    expect(frame).not.toContain(": keepalive");
    expect((await reader.read()).done).toBeTrue();
  });
});
