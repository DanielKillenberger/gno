/**
 * Add a durable monotonic collection egress policy revision.
 *
 * Legacy rows start at zero. Canonical config mutations advance the revision
 * whenever the effective policy or its provenance changes.
 */
import type { Migration } from "./runner";

export const migration: Migration = {
  version: 25,
  name: "collection_egress_policy_revision",

  up(db): void {
    const columns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(collections)")
        .all()
        .map((row) => row.name)
    );
    if (!columns.has("egress_policy_revision")) {
      db.exec(`
        ALTER TABLE collections
        ADD COLUMN egress_policy_revision INTEGER NOT NULL DEFAULT 0
          CHECK (egress_policy_revision >= 0)
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
    if (columns.has("egress_policy_revision")) {
      db.exec("ALTER TABLE collections DROP COLUMN egress_policy_revision");
    }
  },
};
