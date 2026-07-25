/** Attach complete collection policy ownership to observable search results. */

import type { EgressLineage } from "../core/egress-provenance";
import type { StorePort, StoreResult } from "../store/types";
import type { SearchResult } from "./types";

import { parseUri } from "../app/constants";
import { createEgressLineage } from "../core/egress-provenance";
import { err, ok } from "../store/types";

type EgressLineageStore = Pick<
  StorePort,
  "getCollections" | "getDocumentsByMirrorHashes"
>;

export const attachSearchResultEgressLineage = async (
  store: EgressLineageStore,
  results: SearchResult[],
  ownershipHashes?: readonly string[]
): Promise<StoreResult<void>> => {
  if (results.length === 0) return ok(undefined);
  const mirrorHashes = [
    ...new Set(
      ownershipHashes ??
        results
          .map((result) => result.conversion?.mirrorHash)
          .filter((hash): hash is string => Boolean(hash))
    ),
  ];
  const documentsResult =
    typeof store.getDocumentsByMirrorHashes === "function"
      ? await store.getDocumentsByMirrorHashes(mirrorHashes, {
          activeOnly: true,
        })
      : ok([]);
  const collectionsResult = await store.getCollections();
  if (!collectionsResult.ok) return collectionsResult;
  if (!documentsResult.ok) return documentsResult;
  const policyByCollection = new Map(
    collectionsResult.value.map((collection) => [
      collection.name,
      {
        collection: collection.name,
        policy: collection.egressPolicy,
        source: collection.egressPolicySource,
      },
    ])
  );
  const lineageByMirrorHash = new Map<string, EgressLineage>();
  for (const mirrorHash of mirrorHashes) {
    const ownerCollections = [
      ...new Set([
        ...documentsResult.value
          .filter((document) => document.mirrorHash === mirrorHash)
          .map((owner) => owner.collection),
        ...results
          .filter((result) => result.conversion?.mirrorHash === mirrorHash)
          .map((result) => parseUri(result.uri)?.collection)
          .filter((collection): collection is string => Boolean(collection)),
      ]),
    ];
    const policies = ownerCollections.map(
      (collection) =>
        policyByCollection.get(collection) ?? {
          collection,
          policy: "local_only" as const,
          source: "legacy_default" as const,
        }
    );
    if (policies.length === 0) continue;
    try {
      lineageByMirrorHash.set(mirrorHash, createEgressLineage(policies));
    } catch (error) {
      return err(
        "INVALID_INPUT",
        "Search result policy lineage is incomplete",
        error
      );
    }
  }
  for (const result of results) {
    const lineage = result.conversion?.mirrorHash
      ? lineageByMirrorHash.get(result.conversion.mirrorHash)
      : undefined;
    if (!lineage) {
      return err(
        "INVALID_INPUT",
        "Search result policy lineage could not be resolved"
      );
    }
    result.egressLineage = lineage;
  }
  return ok(undefined);
};
