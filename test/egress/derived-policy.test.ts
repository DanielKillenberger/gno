import { describe, expect, test } from "bun:test";

import type { Collection } from "../../src/config/types";
import type { SearchResult } from "../../src/pipeline/types";
import type { StorePort } from "../../src/store/types";

import {
  EgressDeniedError,
  planCollectionEgress,
} from "../../src/core/egress-enforcement";
import {
  createEgressLineage,
  EgressProvenanceError,
  resolveEgressLineage,
} from "../../src/core/egress-provenance";
import { attachSearchResultEgressLineage } from "../../src/pipeline/egress-lineage";

const sources = [
  { collection: "remote", policy: "remote", source: "explicit" },
  { collection: "local", policy: "local_only", source: "legacy_default" },
  { collection: "lan", policy: "lan", source: "explicit" },
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
    for (const requested of [[], ["missing"], [""], [" "]] as const) {
      expect(() => resolveEgressLineage(sources, requested)).toThrow(
        EgressProvenanceError
      );
    }
  });

  test("rejects conflicting policy identities", () => {
    expect(() =>
      createEgressLineage([sources[0], { ...sources[0], policy: "local_only" }])
    ).toThrow("Conflicting policy lineage");
    expect(() => createEgressLineage([sources[0], sources[0]])).toThrow(
      "Duplicate policy lineage"
    );
    expect(() =>
      createEgressLineage([
        { collection: "remote", policy: "remote", source: "config_default" },
      ])
    ).toThrow("invalid collection or policy");
  });

  test("denies mixed transfer by default and discloses explicit partial output", () => {
    const collections: Collection[] = [
      {
        name: "remote",
        path: "/remote",
        pattern: "**/*",
        include: [],
        exclude: [],
        egressPolicy: "remote",
      },
      {
        name: "local",
        path: "/local",
        pattern: "**/*",
        include: [],
        exclude: [],
        egressPolicy: "local_only",
      },
    ];
    const input = {
      collections,
      action: "publish" as const,
      destinationZone: "remote" as const,
      caller: { authenticated: true, operationAuthorized: true },
      contentClass: "capsule" as const,
    };
    expect(() => planCollectionEgress(input)).toThrow(EgressDeniedError);
    expect(
      planCollectionEgress({ ...input, partialResults: "explicit" })
    ).toEqual({
      mode: "partial",
      sourceLineage: createEgressLineage([
        { collection: "local", policy: "local_only", source: "explicit" },
        { collection: "remote", policy: "remote", source: "explicit" },
      ]),
      allowedCollections: ["remote"],
      omittedCollections: [
        { collection: "local", reason: "POLICY_LOCAL_ONLY" },
      ],
      disclosure: {
        code: "EGRESS_PARTIAL_RESULT",
        omittedCount: 1,
        omittedCollections: ["local"],
      },
    });
  });

  test("fails search attachment for an unknown mirror owner", async () => {
    const result: SearchResult = {
      docid: "#abcdef",
      score: 1,
      uri: "gno://remote/shared.md",
      snippet: "shared",
      source: {
        relPath: "shared.md",
        mime: "text/markdown",
        ext: ".md",
        sourceHash: "a".repeat(64),
      },
      conversion: { mirrorHash: "b".repeat(64) },
    };
    const attached = await attachSearchResultEgressLineage(
      {} as Pick<StorePort, "getCollections" | "getDocumentsByMirrorHashes">,
      [result],
      {
        ownershipHashes: ["b".repeat(64)],
        ownershipDocuments: [
          { collection: "unknown", mirrorHash: "b".repeat(64) },
        ],
        collections: [
          {
            name: "remote",
            path: "/remote",
            pattern: "**/*",
            include: [],
            exclude: [],
            updateCmd: null,
            languageHint: null,
            egressPolicy: "remote",
            egressPolicySource: "explicit",
            syncedAt: "",
          },
        ],
      }
    );
    expect(attached.ok).toBe(false);
    expect(result.egressLineage).toBeUndefined();
  });
});
