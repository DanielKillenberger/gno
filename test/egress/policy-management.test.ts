import { describe, expect, test } from "bun:test";

import type { Config } from "../../src/config/types";

import {
  CollectionEgressPolicyService,
  collectionEgressPolicyEpoch,
} from "../../src/core/collection-egress-policy-service";

const config = (): Config =>
  ({
    collections: [
      {
        name: "notes",
        path: "/tmp/notes",
        pattern: "**/*.md",
        include: [],
        exclude: [],
      },
      {
        name: "public",
        path: "/tmp/public",
        pattern: "**/*.md",
        include: [],
        exclude: [],
        egressPolicy: "remote",
      },
    ],
    contexts: [],
  }) as unknown as Config;

describe("collection egress policy management", () => {
  test("requires a relaxation confirmation bound to current policy and version", async () => {
    let current = config();
    const invalidations: string[] = [];
    const service = new CollectionEgressPolicyService({
      getConfig: () => current,
      mutateConfig: async (mutate) => {
        const result = mutate(current);
        if (!result.ok) return result;
        current = result.config;
        return { ok: true, config: current, value: result.value };
      },
      onPolicyChanged: () => {
        const policyEpoch = collectionEgressPolicyEpoch(current);
        invalidations.push(policyEpoch);
        return {
          policyEpoch,
          queuedJobsInvalidated: 2,
          sessionsInvalidated: 1,
          staleWorkMustRetry: true,
        };
      },
    });
    const before = service.get("notes");
    expect(before).not.toBeNull();
    expect(before?.effectivePolicy).toBe("local_only");
    expect(before?.source).toBe("config_default");

    const unconfirmed = await service.set({
      collection: "notes",
      policy: "remote",
    });
    expect(unconfirmed).toMatchObject({
      ok: false,
      code: "EGRESS_RELAXATION_CONFIRMATION_REQUIRED",
    });
    const stale = await service.set({
      collection: "notes",
      policy: "remote",
      confirmation: {
        currentPolicy: "local_only",
        currentVersion: "stale",
        acknowledged: true,
      },
    });
    expect(stale.ok).toBeFalse();

    const changed = await service.set({
      collection: "notes",
      policy: "remote",
      confirmation: {
        currentPolicy: "local_only",
        currentVersion: before?.version ?? "",
        acknowledged: true,
      },
    });
    expect(changed).toMatchObject({
      ok: true,
      value: {
        change: "relaxed",
        current: { effectivePolicy: "remote", source: "explicit" },
        invalidation: {
          queuedJobsInvalidated: 2,
          sessionsInvalidated: 1,
          staleWorkMustRetry: true,
        },
      },
    });
    expect(invalidations).toHaveLength(1);
    expect(current.collections[1]?.egressPolicy).toBe("remote");
  });

  test("returns one content-free check/explain contract with partial disclosure", () => {
    const service = new CollectionEgressPolicyService({
      getConfig: config,
    });
    const denied = service.explain({
      collections: ["notes", "public"],
      action: "export",
      destinationZone: "remote",
      caller: { authenticated: true, operationAuthorized: true },
      contentClass: "retrieval_trace",
    });
    expect(denied).toMatchObject({
      mode: "denied",
      decision: { allowed: false, reason: "POLICY_LOCAL_ONLY" },
      remediation: { code: "POLICY_LOCAL_ONLY" },
    });
    expect(JSON.stringify(denied)).not.toContain("/tmp/");

    const partial = service.check({
      collections: ["notes", "public"],
      action: "export",
      destinationZone: "remote",
      caller: { authenticated: true, operationAuthorized: true },
      contentClass: "retrieval_trace",
      partialResults: "explicit",
    });
    expect(partial).toMatchObject({
      mode: "partial",
      allowedCollections: ["public"],
      omittedCollections: [
        { collection: "notes", reason: "POLICY_LOCAL_ONLY" },
      ],
      disclosure: {
        code: "EGRESS_PARTIAL_RESULT",
        omittedCount: 1,
      },
    });
  });
});
