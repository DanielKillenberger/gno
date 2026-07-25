/** Persist bounded logical-record lineage for file/export adapters. */
import type { Migration } from "./runner";

export const migration: Migration = {
  version: 22,
  name: "record_export_lineage",

  up(db): void {
    const columns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(documents)")
        .all()
        .map((row) => row.name)
    );
    const additions = [
      ["record_key", "TEXT"],
      ["record_source_path", "TEXT"],
      ["record_source_locator", "TEXT"],
      ["record_metadata", "TEXT"],
      ["record_anchors", "TEXT"],
      ["record_adapter_fingerprint", "TEXT"],
    ] as const;
    for (const [name, type] of additions) {
      if (!columns.has(name)) {
        db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${type}`);
      }
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_record_key
      ON documents(collection, record_source_path, record_key)
      WHERE record_source_path IS NOT NULL AND record_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_documents_record_source_path
      ON documents(collection, record_source_path)
      WHERE record_source_path IS NOT NULL;
    `);
  },

  down(db): void {
    db.exec("DROP INDEX IF EXISTS idx_documents_record_key");
    db.exec("DROP INDEX IF EXISTS idx_documents_record_source_path");
  },
};
