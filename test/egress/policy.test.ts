import { describe, expect, test } from "bun:test";

import {
  CollectionSchema,
  EGRESS_POLICIES,
  EGRESS_POLICY_SOURCES,
  resolveConfiguredEgressPolicy,
} from "../../src/config/types";
import {
  EGRESS_ACTIONS,
  EGRESS_CONTENT_CLASSES,
  EGRESS_DESTINATION_ZONES,
  EGRESS_MAX_COLLECTIONS,
  EGRESS_REASON_CODES,
  type EgressAction,
  type EgressContentClass,
  type EgressDestinationZone,
  type EgressEvaluationInput,
  evaluateEgressPolicy,
} from "../../src/core/egress-policy";

const explicitRemote = {
  collection: "notes",
  policy: "remote",
  source: "explicit",
} as const;

const destinationForAction: Record<EgressAction, EgressDestinationZone> = {
  retrieve: "local_process",
  serve: "loopback",
  publish: "remote",
  remote_inference: "remote",
  export: "local_process",
  clip_write: "loopback",
};

function request(
  action: EgressAction = "retrieve",
  contentClass: EgressContentClass = "source"
): EgressEvaluationInput {
  return {
    collections: [explicitRemote],
    action,
    destination: {
      zone: destinationForAction[action],
      host: "secret.internal.example",
      provider: "provider-with-secret-query",
    },
    caller: {
      authenticated: true,
      operationAuthorized: true,
    },
    contentClass,
  };
}

describe("collection egress policy", () => {
  test("resolves absent config fail-closed without erasing explicit provenance", () => {
    const base = {
      name: "notes",
      path: "/notes",
      pattern: "**/*",
      include: [],
      exclude: [],
    };
    const defaulted = CollectionSchema.parse(base);
    expect(defaulted.egressPolicy).toBeUndefined();
    expect(resolveConfiguredEgressPolicy(defaulted)).toEqual({
      policy: "local_only",
      source: "config_default",
    });

    const explicit = CollectionSchema.parse({
      ...base,
      egressPolicy: "lan",
    });
    expect(resolveConfiguredEgressPolicy(explicit)).toEqual({
      policy: "lan",
      source: "explicit",
    });
    expect(
      CollectionSchema.safeParse({ ...base, egressPolicy: "future" }).success
    ).toBe(false);
  });

  test("covers every action and source/derived content class", () => {
    for (const action of EGRESS_ACTIONS) {
      for (const contentClass of EGRESS_CONTENT_CLASSES) {
        const result = evaluateEgressPolicy(request(action, contentClass));
        expect(result.allowed).toBe(true);
        expect(result.code).toBe("EGRESS_ALLOWED");
      }
    }
  });

  test("defines every action and destination-zone decision", () => {
    const matrix = [
      ["retrieve", "local_process", true, "LOCAL_DESTINATION"],
      ["retrieve", "loopback", true, "LOCAL_DESTINATION"],
      ["retrieve", "lan", true, "LAN_POLICY_AUTHENTICATED"],
      ["retrieve", "remote", true, "REMOTE_POLICY_AUTHENTICATED"],
      ["serve", "local_process", false, "ACTION_DESTINATION_MISMATCH"],
      ["serve", "loopback", true, "LOCAL_DESTINATION"],
      ["serve", "lan", true, "LAN_POLICY_AUTHENTICATED"],
      ["serve", "remote", true, "REMOTE_POLICY_AUTHENTICATED"],
      ["publish", "local_process", false, "ACTION_DESTINATION_MISMATCH"],
      ["publish", "loopback", false, "ACTION_DESTINATION_MISMATCH"],
      ["publish", "lan", false, "ACTION_DESTINATION_MISMATCH"],
      ["publish", "remote", true, "REMOTE_POLICY_AUTHENTICATED"],
      [
        "remote_inference",
        "local_process",
        false,
        "ACTION_DESTINATION_MISMATCH",
      ],
      ["remote_inference", "loopback", false, "ACTION_DESTINATION_MISMATCH"],
      ["remote_inference", "lan", false, "ACTION_DESTINATION_MISMATCH"],
      ["remote_inference", "remote", true, "REMOTE_POLICY_AUTHENTICATED"],
      ["export", "local_process", true, "LOCAL_DESTINATION"],
      ["export", "loopback", false, "ACTION_DESTINATION_MISMATCH"],
      ["export", "lan", true, "LAN_POLICY_AUTHENTICATED"],
      ["export", "remote", true, "REMOTE_POLICY_AUTHENTICATED"],
      ["clip_write", "local_process", true, "LOCAL_DESTINATION"],
      ["clip_write", "loopback", true, "LOCAL_DESTINATION"],
      ["clip_write", "lan", true, "LAN_POLICY_AUTHENTICATED"],
      ["clip_write", "remote", true, "REMOTE_POLICY_AUTHENTICATED"],
    ] as const;
    expect(matrix).toHaveLength(
      EGRESS_ACTIONS.length * EGRESS_DESTINATION_ZONES.length
    );
    for (const [action, zone, allowed, reason] of matrix) {
      const input = request(action);
      input.destination.zone = zone;
      expect(evaluateEgressPolicy(input)).toMatchObject({
        allowed,
        reason,
      });
    }
  });

  test("enforces action and destination compatibility", () => {
    for (const action of ["publish", "remote_inference"] as const) {
      const input = request(action);
      input.destination.zone = "loopback";
      expect(evaluateEgressPolicy(input)).toMatchObject({
        allowed: false,
        code: "EGRESS_DENIED",
        reason: "ACTION_DESTINATION_MISMATCH",
      });
    }

    const localExport = request("export");
    localExport.collections = [
      {
        collection: "notes",
        policy: "local_only",
        source: "config_default",
      },
    ];
    expect(evaluateEgressPolicy(localExport)).toMatchObject({
      allowed: true,
      reason: "LOCAL_DESTINATION",
    });

    const loopbackExport = request("export");
    loopbackExport.destination.zone = "loopback";
    expect(evaluateEgressPolicy(loopbackExport).reason).toBe(
      "ACTION_DESTINATION_MISMATCH"
    );
  });

  test("intersects policy with authentication without allowing overrides", () => {
    const localOnlyRemote = request("publish");
    localOnlyRemote.collections = [
      {
        collection: "private",
        policy: "local_only",
        source: "explicit",
      },
    ];
    expect(evaluateEgressPolicy(localOnlyRemote)).toMatchObject({
      allowed: false,
      reason: "POLICY_LOCAL_ONLY",
    });

    const lanRemote = request("publish");
    lanRemote.collections = [
      { collection: "team", policy: "lan", source: "explicit" },
    ];
    expect(evaluateEgressPolicy(lanRemote)).toMatchObject({
      allowed: false,
      reason: "POLICY_LAN_ONLY",
    });

    const unauthenticatedLan = request("serve");
    unauthenticatedLan.destination.zone = "lan";
    unauthenticatedLan.collections = [
      { collection: "team", policy: "lan", source: "explicit" },
    ];
    unauthenticatedLan.caller.authenticated = false;
    expect(evaluateEgressPolicy(unauthenticatedLan)).toMatchObject({
      allowed: false,
      reason: "AUTHENTICATION_REQUIRED",
    });

    const unauthorizedLocal = request();
    unauthorizedLocal.caller.operationAuthorized = false;
    expect(evaluateEgressPolicy(unauthorizedLocal)).toMatchObject({
      allowed: false,
      reason: "CALLER_NOT_AUTHORIZED",
    });
  });

  test("uses the most restrictive collection and deterministic source", () => {
    const input = request("serve");
    input.destination.zone = "lan";
    input.collections = [
      { collection: "remote", policy: "remote", source: "explicit" },
      {
        collection: "legacy",
        policy: "local_only",
        source: "legacy_default",
      },
      {
        collection: "defaulted",
        policy: "local_only",
        source: "config_default",
      },
    ];
    const result = evaluateEgressPolicy(input);
    expect(result).toMatchObject({
      allowed: false,
      reason: "POLICY_LOCAL_ONLY",
      audit: {
        collectionCount: 3,
        collections: ["defaulted", "legacy", "remote"],
        effectivePolicy: "local_only",
        effectivePolicySource: "mixed",
      },
    });
  });

  test("rejects every non-explicit non-local policy pair", () => {
    for (const source of ["config_default", "legacy_default"] as const) {
      for (const policy of ["lan", "remote"] as const) {
        const input = request();
        input.collections = [{ collection: "notes", policy, source }];
        expect(evaluateEgressPolicy(input)).toMatchObject({
          allowed: false,
          code: "EGRESS_DENIED",
          reason: "INVALID_POLICY_SOURCE_PAIR",
        });
      }
    }

    const mixed = request("serve");
    mixed.destination.zone = "lan";
    mixed.collections = [
      { collection: "explicit", policy: "remote", source: "explicit" },
      {
        collection: "invalid_default",
        policy: "lan",
        source: "config_default",
      },
    ];
    expect(evaluateEgressPolicy(mixed).reason).toBe(
      "INVALID_POLICY_SOURCE_PAIR"
    );

    for (const source of ["config_default", "legacy_default"] as const) {
      const input = request();
      input.collections = [
        { collection: "notes", policy: "local_only", source },
      ];
      expect(evaluateEgressPolicy(input)).toMatchObject({
        allowed: true,
        reason: "LOCAL_DESTINATION",
      });
    }
  });

  test("bounds collection evaluation and audit projection before iteration", () => {
    const atLimit = request();
    atLimit.collections = Array.from(
      { length: EGRESS_MAX_COLLECTIONS },
      (_, index) => ({
        collection: `collection_${index}`,
        policy: "remote" as const,
        source: "explicit" as const,
      })
    );
    const allowed = evaluateEgressPolicy(atLimit);
    expect(allowed.allowed).toBe(true);
    expect(allowed.audit.collectionCount).toBe(EGRESS_MAX_COLLECTIONS);
    expect(allowed.audit.collections).toHaveLength(EGRESS_MAX_COLLECTIONS);

    const overLimit = request();
    overLimit.collections = [
      ...atLimit.collections,
      {
        collection: "one_too_many",
        policy: "remote",
        source: "explicit",
      },
    ];
    const denied = evaluateEgressPolicy(overLimit);
    expect(denied).toMatchObject({
      allowed: false,
      reason: "COLLECTION_LIMIT_EXCEEDED",
      audit: {
        collectionCount: EGRESS_MAX_COLLECTIONS + 1,
        collections: [],
      },
    });

    const hugeSparse: unknown[] = [];
    hugeSparse.length = 1_000_000_000;
    const sparseInput = {
      ...request(),
      collections: hugeSparse,
    };
    const sparseDecision = evaluateEgressPolicy(sparseInput);
    expect(sparseDecision.reason).toBe("COLLECTION_LIMIT_EXCEEDED");
    expect(JSON.stringify(sparseDecision).length).toBeLessThan(512);
  });

  test("contains hostile getters proxies and sparse entries", () => {
    const throwingTopLevel = {};
    Object.defineProperty(throwingTopLevel, "collections", {
      get(): never {
        throw new Error("secret getter");
      },
    });

    const throwingCollection = {};
    Object.defineProperty(throwingCollection, "collection", {
      get(): never {
        throw new Error("secret collection");
      },
    });
    const nested = {
      ...request(),
      collections: [throwingCollection],
    };

    const sparseCollections: unknown[] = [];
    sparseCollections.length = 4;
    const sparseWithinLimit = {
      ...request(),
      collections: sparseCollections,
    };

    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    for (const hostile of [
      throwingTopLevel,
      nested,
      sparseWithinLimit,
      revocable.proxy,
    ]) {
      expect(() => evaluateEgressPolicy(hostile)).not.toThrow();
      const result = evaluateEgressPolicy(hostile);
      expect(result.allowed).toBe(false);
      if (hostile === sparseWithinLimit) {
        expect(result.reason).toBe("INVALID_COLLECTION");
        expect(result.audit.collections).toEqual([
          "unknown",
          "unknown",
          "unknown",
          "unknown",
        ]);
      } else {
        expect(result).toEqual({
          allowed: false,
          code: "EGRESS_DENIED",
          reason: "INVALID_INPUT",
          audit: {
            action: "unknown",
            destinationZone: "unknown",
            contentClass: "unknown",
            collectionCount: 0,
            collections: [],
            effectivePolicy: "unknown",
            effectivePolicySource: "unknown",
            callerAuthenticated: null,
            callerOperationAuthorized: null,
          },
        });
      }
    }
  });

  test("structured-denies malformed and unknown inputs without throwing", () => {
    expect(evaluateEgressPolicy(null)).toMatchObject({
      allowed: false,
      code: "EGRESS_DENIED",
      reason: "INVALID_INPUT",
    });
    expect(evaluateEgressPolicy(undefined)).toMatchObject({
      allowed: false,
      reason: "INVALID_INPUT",
    });
    expect(
      evaluateEgressPolicy("malformed" as unknown as EgressEvaluationInput)
    ).toMatchObject({
      allowed: false,
      reason: "INVALID_INPUT",
    });

    const cases = [
      ["UNKNOWN_ACTION", { action: "future_action" }],
      ["UNKNOWN_DESTINATION", { destination: { zone: "vpn" } }],
      ["UNKNOWN_CONTENT_CLASS", { contentClass: "summary" }],
      ["INVALID_CALLER", { caller: null }],
      [
        "INVALID_COLLECTION",
        { collections: [{ ...explicitRemote, collection: "/secret" }] },
      ],
      [
        "UNKNOWN_POLICY",
        { collections: [{ ...explicitRemote, policy: "future" }] },
      ],
      [
        "UNKNOWN_POLICY_SOURCE",
        { collections: [{ ...explicitRemote, source: "inferred" }] },
      ],
    ] as const;
    for (const [reason, overrides] of cases) {
      const candidate = {
        ...request(),
        ...overrides,
      } as unknown as EgressEvaluationInput;
      expect(() => evaluateEgressPolicy(candidate)).not.toThrow();
      expect(evaluateEgressPolicy(candidate)).toMatchObject({
        allowed: false,
        code: "EGRESS_DENIED",
        reason,
      });
    }
  });

  test("returns closed stable enums and redacted audit metadata", () => {
    expect(new Set(EGRESS_REASON_CODES).size).toBe(EGRESS_REASON_CODES.length);
    expect(EGRESS_POLICIES).toEqual(["local_only", "lan", "remote"]);
    expect(EGRESS_POLICY_SOURCES).toEqual([
      "explicit",
      "config_default",
      "legacy_default",
    ]);

    const input = request("publish", "capsule");
    const serialized = JSON.stringify(evaluateEgressPolicy(input));
    expect(serialized).not.toContain(input.destination.host ?? "");
    expect(serialized).not.toContain(input.destination.provider ?? "");
    expect(serialized).not.toContain("/notes");
    expect(serialized).toContain('"collectionCount":1');
    expect(serialized).toContain('"collections":["notes"]');
  });
});
