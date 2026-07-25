import { describe, expect, test } from "bun:test";

import { assertInvalid, assertValid, loadSchema } from "./validator";

const HASH = "a".repeat(64);
const state = {
  schemaVersion: "1.0",
  collection: "notes",
  configuredPolicy: null,
  effectivePolicy: "local_only",
  revision: 0,
  source: "config_default",
  version: `egress-policy-v1:${HASH}`,
} as const;

describe("collection egress management schemas", () => {
  test("validate policy, mutation, explanation, and audit outputs", async () => {
    expect(
      assertValid(state, await loadSchema("collection-egress-policy"))
    ).toBeTrue();
    expect(
      assertValid(
        {
          schemaVersion: "1.0",
          previous: state,
          current: {
            ...state,
            configuredPolicy: "remote",
            effectivePolicy: "remote",
            revision: 1,
            source: "explicit",
          },
          change: "relaxed",
          invalidation: {
            policyEpoch: `egress-epoch-v1:${HASH}`,
            queuedJobsInvalidated: 1,
            sessionsInvalidated: 2,
            staleWorkMustRetry: true,
          },
        },
        await loadSchema("collection-egress-policy-set")
      )
    ).toBeTrue();
    expect(
      assertValid(
        {
          schemaVersion: "1.0",
          mode: "denied",
          allowedCollections: [],
          omittedCollections: [
            { collection: "notes", reason: "POLICY_LOCAL_ONLY" },
          ],
          disclosure: null,
          lineage: {
            effectivePolicy: "local_only",
            digest: HASH,
            sources: [
              {
                collection: "notes",
                policy: "local_only",
                source: "config_default",
              },
            ],
          },
          decision: {
            allowed: false,
            code: "EGRESS_DENIED",
            reason: "POLICY_LOCAL_ONLY",
            audit: {},
          },
          remediation: {
            code: "POLICY_LOCAL_ONLY",
            message: "Keep the action local.",
          },
        },
        await loadSchema("collection-egress-check")
      )
    ).toBeTrue();
    expect(
      assertValid(
        {
          schemaVersion: "1.0",
          receipts: [],
          nextCursor: null,
        },
        await loadSchema("egress-audit-management")
      )
    ).toBeTrue();
  });

  test("rejects stale shapes and unbound policy versions", async () => {
    const schema = await loadSchema("collection-egress-policy");
    expect(assertInvalid({ ...state, version: "latest" }, schema)).toBeTrue();
    expect(assertInvalid({ ...state, revision: -1 }, schema)).toBeTrue();
    expect(
      assertInvalid({ ...state, source: "legacy_default" }, schema)
    ).toBeTrue();
    expect(assertInvalid({ ...state, path: "/private" }, schema)).toBeTrue();
  });
});
