/**
 * Add fail-closed collection egress policy state.
 *
 * Existing rows become local-only with legacy_default provenance. Config sync
 * can later replace that value with config_default or an explicit user choice
 * without affecting local retrieval/indexing.
 */
import type { Migration } from "./runner";

export const migration: Migration = {
  version: 23,
  name: "collection_egress_policy",

  up(db): void {
    const columns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(collections)")
        .all()
        .map((row) => row.name)
    );
    if (!columns.has("egress_policy")) {
      db.exec(`
        ALTER TABLE collections
        ADD COLUMN egress_policy TEXT NOT NULL DEFAULT 'local_only'
          CHECK (egress_policy IN ('local_only', 'lan', 'remote'))
      `);
    }
    if (!columns.has("egress_policy_source")) {
      db.exec(`
        ALTER TABLE collections
        ADD COLUMN egress_policy_source TEXT NOT NULL DEFAULT 'legacy_default'
          CHECK (
            egress_policy_source IN (
              'explicit',
              'config_default',
              'legacy_default'
            )
          )
          CHECK (
            egress_policy_source = 'explicit'
            OR egress_policy = 'local_only'
          )
      `);
    }
  },

  down(db): void {
    const columns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(collections)")
        .all()
        .map((row) => row.name)
    );
    if (columns.has("egress_policy_source")) {
      db.exec("ALTER TABLE collections DROP COLUMN egress_policy_source");
    }
    if (columns.has("egress_policy")) {
      db.exec("ALTER TABLE collections DROP COLUMN egress_policy");
    }
  },
};
