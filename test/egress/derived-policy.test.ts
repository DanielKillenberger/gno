import { describe, expect, test } from "bun:test";

import {
  createEgressLineage,
  EgressProvenanceError,
  resolveEgressLineage,
} from "../../src/core/egress-provenance";

const sources = [
  { collection: "remote", policy: "remote", source: "explicit" },
  { collection: "local", policy: "local_only", source: "legacy_default" },
  { collection: "lan", policy: "lan", source: "config_default" },
] as const;

describe("derived egress policy lineage", () => {
  test("sorts immutable membership and preserves the most restrictive policy", () => {
    const lineage = createEgressLineage(sources);

    expect(lineage.effectivePolicy).toBe("local_only");
    expect(lineage.sources.map(({ collection }) => collection)).toEqual([
      "lan",
      "local",
      "remote",
    ]);
    expect(lineage.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(lineage)).toBe(true);
    expect(Object.isFrozen(lineage.sources)).toBe(true);
    expect(createEgressLineage([...sources].reverse())).toEqual(lineage);
  });

  test("fails closed for empty and unknown requested scopes", () => {
    for (const requested of [[], ["missing"]] as const) {
      expect(() => resolveEgressLineage(sources, requested)).toThrow(
        EgressProvenanceError
      );
    }
  });

  test("rejects conflicting policy identities", () => {
    expect(() =>
      createEgressLineage([sources[0], { ...sources[0], policy: "local_only" }])
    ).toThrow("Conflicting policy lineage");
  });
});
