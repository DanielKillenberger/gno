/** Attach complete collection policy ownership to observable search results. */

import type { EgressLineage } from "../core/egress-provenance";
import type {
  CollectionRow,
  DocumentRow,
  StorePort,
  StoreResult,
} from "../store/types";
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
  options: {
    ownershipHashes?: readonly string[];
    ownershipDocuments?: readonly Pick<
      DocumentRow,
      "collection" | "mirrorHash"
    >[];
    collections?: readonly CollectionRow[];
  } = {}
): Promise<StoreResult<void>> => {
  if (results.length === 0) return ok(undefined);
  const mirrorHashes = [
    ...new Set(
      options.ownershipHashes ??
        results
          .map((result) => result.conversion?.mirrorHash)
          .filter((hash): hash is string => Boolean(hash))
    ),
  ];
  let ownershipDocuments = options.ownershipDocuments;
  if (ownershipDocuments === undefined) {
    const documentsResult = await store.getDocumentsByMirrorHashes(
      mirrorHashes,
      {
        activeOnly: true,
      }
    );
    if (!documentsResult.ok) return documentsResult;
    ownershipDocuments = documentsResult.value;
  }
  let collectionRows = options.collections;
  if (collectionRows === undefined) {
    const collectionsResult = await store.getCollections();
    if (!collectionsResult.ok) return collectionsResult;
    collectionRows = collectionsResult.value;
  }
  const policyByCollection = new Map(
    collectionRows.map((collection) => [
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
        ...ownershipDocuments
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
