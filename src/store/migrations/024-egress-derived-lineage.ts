/** Persist derived egress lineage and bounded redacted audit receipts. */

import type { Database } from "bun:sqlite";

import type { Migration } from "./runner";

const LEGACY_LINEAGE_JSON =
  '{"digest":"87b249b76459c91c172da6be6cbe3f93b61c44869eb196f3470ec36ebb50b8b0","effectivePolicy":"local_only","sources":[{"collection":"legacy","policy":"local_only","source":"legacy_default"}]}';
const LEGACY_LINEAGE_DIGEST =
  "87b249b76459c91c172da6be6cbe3f93b61c44869eb196f3470ec36ebb50b8b0";

export const migration: Migration = {
  version: 24,
  name: "egress_derived_lineage",

  up(db: Database): void {
    const lineageBytes = new TextEncoder().encode(
      LEGACY_LINEAGE_JSON
    ).byteLength;
    db.exec(`
      ALTER TABLE retrieval_traces
      ADD COLUMN effective_egress_policy TEXT NOT NULL DEFAULT 'local_only'
        CHECK (effective_egress_policy IN ('local_only', 'lan', 'remote'));
      ALTER TABLE retrieval_traces
      ADD COLUMN egress_lineage_digest TEXT NOT NULL DEFAULT '${LEGACY_LINEAGE_DIGEST}'
        CHECK (length(egress_lineage_digest) = 64 AND egress_lineage_digest NOT GLOB '*[^0-9a-f]*');
      ALTER TABLE retrieval_traces
      ADD COLUMN egress_lineage_json TEXT NOT NULL DEFAULT '${LEGACY_LINEAGE_JSON}';
      ALTER TABLE retrieval_traces
      ADD COLUMN egress_lineage_bytes INTEGER NOT NULL DEFAULT ${lineageBytes}
        CHECK (egress_lineage_bytes > 0 AND egress_lineage_bytes <= 32768);

      ALTER TABLE retrieval_trace_exports
      ADD COLUMN effective_egress_policy TEXT NOT NULL DEFAULT 'local_only'
        CHECK (effective_egress_policy IN ('local_only', 'lan', 'remote'));
      ALTER TABLE retrieval_trace_exports
      ADD COLUMN egress_lineage_digest TEXT NOT NULL DEFAULT '${LEGACY_LINEAGE_DIGEST}'
        CHECK (length(egress_lineage_digest) = 64 AND egress_lineage_digest NOT GLOB '*[^0-9a-f]*');
      ALTER TABLE retrieval_trace_exports
      ADD COLUMN egress_lineage_json TEXT NOT NULL DEFAULT '${LEGACY_LINEAGE_JSON}';
      ALTER TABLE retrieval_trace_exports
      ADD COLUMN egress_lineage_bytes INTEGER NOT NULL DEFAULT ${lineageBytes}
        CHECK (egress_lineage_bytes > 0 AND egress_lineage_bytes <= 32768);

      ALTER TABLE document_changes
      ADD COLUMN effective_egress_policy TEXT NOT NULL DEFAULT 'local_only'
        CHECK (effective_egress_policy IN ('local_only', 'lan', 'remote'));
      ALTER TABLE document_changes
      ADD COLUMN egress_lineage_digest TEXT NOT NULL DEFAULT '${LEGACY_LINEAGE_DIGEST}'
        CHECK (length(egress_lineage_digest) = 64 AND egress_lineage_digest NOT GLOB '*[^0-9a-f]*');
      ALTER TABLE document_changes
      ADD COLUMN egress_lineage_json TEXT NOT NULL DEFAULT '${LEGACY_LINEAGE_JSON}';
      ALTER TABLE document_changes
      ADD COLUMN egress_lineage_bytes INTEGER NOT NULL DEFAULT ${lineageBytes}
        CHECK (egress_lineage_bytes > 0 AND egress_lineage_bytes <= 32768);

      UPDATE document_changes
      SET byte_size = byte_size + egress_lineage_bytes;
      UPDATE document_change_journal_state
      SET retained_bytes = (
        SELECT COALESCE(SUM(byte_size), 0) FROM document_changes
      );

      CREATE TABLE egress_audit_receipts (
        audit_id TEXT PRIMARY KEY,
        decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
        action TEXT NOT NULL
          CHECK (action IN ('retrieve', 'serve', 'publish', 'remote_inference', 'export', 'clip_write')),
        destination_zone TEXT NOT NULL
          CHECK (destination_zone IN ('local_process', 'loopback', 'lan', 'remote')),
        content_class TEXT NOT NULL
          CHECK (content_class IN ('source', 'snippet', 'metadata', 'attachment', 'embedding', 'capsule', 'audit_log', 'retrieval_trace')),
        effective_policy TEXT NOT NULL
          CHECK (effective_policy IN ('local_only', 'lan', 'remote')),
        reason_code TEXT NOT NULL,
        lineage_digest TEXT NOT NULL
          CHECK (length(lineage_digest) = 64 AND lineage_digest NOT GLOB '*[^0-9a-f]*'),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
        byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 4096),
        CHECK (length(audit_id) BETWEEN 1 AND 128),
        CHECK (length(reason_code) BETWEEN 1 AND 64)
      );

      CREATE INDEX idx_egress_audit_retention
      ON egress_audit_receipts(expires_at_ms, created_at_ms, audit_id);
    `);
  },

  down(db: Database): void {
    db.exec(`
      DROP TABLE egress_audit_receipts;

      UPDATE document_changes
      SET byte_size = byte_size - egress_lineage_bytes;
      UPDATE document_change_journal_state
      SET retained_bytes = (
        SELECT COALESCE(SUM(byte_size), 0) FROM document_changes
      );

      ALTER TABLE document_changes DROP COLUMN egress_lineage_bytes;
      ALTER TABLE document_changes DROP COLUMN egress_lineage_json;
      ALTER TABLE document_changes DROP COLUMN egress_lineage_digest;
      ALTER TABLE document_changes DROP COLUMN effective_egress_policy;

      ALTER TABLE retrieval_trace_exports DROP COLUMN egress_lineage_bytes;
      ALTER TABLE retrieval_trace_exports DROP COLUMN egress_lineage_json;
      ALTER TABLE retrieval_trace_exports DROP COLUMN egress_lineage_digest;
      ALTER TABLE retrieval_trace_exports DROP COLUMN effective_egress_policy;

      ALTER TABLE retrieval_traces DROP COLUMN egress_lineage_bytes;
      ALTER TABLE retrieval_traces DROP COLUMN egress_lineage_json;
      ALTER TABLE retrieval_traces DROP COLUMN egress_lineage_digest;
      ALTER TABLE retrieval_traces DROP COLUMN effective_egress_policy;
    `);
  },
};
