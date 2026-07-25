/** Targeted config-to-store projection for one egress policy mutation. */

import type { Config } from "../config/types";
import type { SqliteAdapter } from "../store/sqlite/adapter";

import { parseCollectionName } from "./collection-egress-policy-validation";

export const projectCollectionEgressPolicy = async (
  store: SqliteAdapter,
  config: Config,
  collectionValue: unknown
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const parsed = parseCollectionName(collectionValue);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const collection = config.collections.find(
    ({ name }) => name === parsed.value
  );
  if (!collection) {
    return {
      ok: false,
      error: "Collection policy projection target is missing",
    };
  }
  const projected = await store.upsertCollections([collection]);
  return projected.ok
    ? { ok: true }
    : { ok: false, error: projected.error.message };
};
