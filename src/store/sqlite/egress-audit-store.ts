/** Bounded, content-free SQLite egress decision receipts. */

import type { Database } from "bun:sqlite";

import type {
  EgressAuditCursor,
  EgressAuditDeleteResult,
  EgressAuditPage,
  EgressAuditPurgeResult,
  EgressAuditReceiptInput,
  EgressAuditReceiptRow,
  EgressAuditRetentionPolicy,
  EgressAuditRetentionResult,
  EgressAuditStatusResult,
  RetrievalTraceAppendResult,
  StoreResult,
} from "../types";

import {
  EGRESS_ACTIONS,
  EGRESS_CONTENT_CLASSES,
  EGRESS_DESTINATION_ZONES,
  EGRESS_REASON_CODES,
} from "../../core/egress-policy";
import { err, ok } from "../types";

const DAY_MS = 86_400_000;
const MAX_LIMIT = 1_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UTF8 = new TextEncoder();

interface DbAuditRow {
  audit_id: string;
  decision: EgressAuditReceiptRow["decision"];
  action: EgressAuditReceiptRow["action"];
  destination_zone: EgressAuditReceiptRow["destinationZone"];
  content_class: EgressAuditReceiptRow["contentClass"];
  effective_policy: EgressAuditReceiptRow["effectivePolicy"];
  reason_code: EgressAuditReceiptRow["reasonCode"];
  lineage_digest: string;
  created_at_ms: number;
  expires_at_ms: number;
  byte_size: number;
}

const mapRow = (row: DbAuditRow): EgressAuditReceiptRow => ({
  auditId: row.audit_id,
  decision: row.decision,
  action: row.action,
  destinationZone: row.destination_zone,
  contentClass: row.content_class,
  effectivePolicy: row.effective_policy,
  reasonCode: row.reason_code,
  lineageDigest: row.lineage_digest,
  createdAtMs: row.created_at_ms,
  expiresAtMs: row.expires_at_ms,
  byteSize: row.byte_size,
});

const receiptBytes = (receipt: EgressAuditReceiptInput): number =>
  [
    receipt.auditId,
    receipt.decision,
    receipt.action,
    receipt.destinationZone,
    receipt.contentClass,
    receipt.effectivePolicy,
    receipt.reasonCode,
    receipt.lineageDigest,
  ].reduce((total, value) => total + UTF8.encode(value).byteLength, 16);

const validateReceipt = (receipt: EgressAuditReceiptInput): void => {
  if (
    receipt.auditId.length < 1 ||
    receipt.auditId.length > 128 ||
    !["allow", "deny"].includes(receipt.decision) ||
    !EGRESS_ACTIONS.includes(receipt.action) ||
    !EGRESS_DESTINATION_ZONES.includes(receipt.destinationZone) ||
    !EGRESS_CONTENT_CLASSES.includes(receipt.contentClass) ||
    !["local_only", "lan", "remote"].includes(receipt.effectivePolicy) ||
    !EGRESS_REASON_CODES.includes(receipt.reasonCode) ||
    !SHA256_PATTERN.test(receipt.lineageDigest) ||
    !Number.isSafeInteger(receipt.createdAtMs) ||
    receipt.createdAtMs < 0 ||
    !Number.isSafeInteger(receipt.expiresAtMs) ||
    receipt.expiresAtMs <= receipt.createdAtMs
  ) {
    throw new RangeError("Invalid egress audit receipt");
  }
};

const readSecureDelete = (db: Database): number =>
  db.query<{ secure_delete: number }, []>("PRAGMA secure_delete").get()
    ?.secure_delete ?? 0;

const restoreSecureDelete = (db: Database, value: number): void => {
  const mode = value === 0 ? "OFF" : value === 2 ? "FAST" : "ON";
  db.exec(`PRAGMA secure_delete = ${mode}`);
};

export const appendEgressAuditReceipt = (
  db: Database,
  receipt: EgressAuditReceiptInput
): StoreResult<RetrievalTraceAppendResult> => {
  try {
    validateReceipt(receipt);
    const byteSize = receiptBytes(receipt);
    const inserted = db.run(
      `INSERT OR IGNORE INTO egress_audit_receipts (
         audit_id, decision, action, destination_zone, content_class,
         effective_policy, reason_code, lineage_digest, created_at_ms,
         expires_at_ms, byte_size
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.auditId,
        receipt.decision,
        receipt.action,
        receipt.destinationZone,
        receipt.contentClass,
        receipt.effectivePolicy,
        receipt.reasonCode,
        receipt.lineageDigest,
        receipt.createdAtMs,
        receipt.expiresAtMs,
        byteSize,
      ]
    );
    if (inserted.changes > 0) return ok("inserted");
    const stored = db
      .query<DbAuditRow, [string]>(
        "SELECT * FROM egress_audit_receipts WHERE audit_id = ?"
      )
      .get(receipt.auditId);
    return stored &&
      JSON.stringify(mapRow(stored)) ===
        JSON.stringify({ ...receipt, byteSize })
      ? ok("duplicate")
      : err(
          "CONSTRAINT_VIOLATION",
          "Egress audit ID already exists with different content"
        );
  } catch (cause) {
    return err(
      cause instanceof RangeError ? "INVALID_INPUT" : "QUERY_FAILED",
      cause instanceof Error ? cause.message : "Failed to append egress audit",
      cause
    );
  }
};

export const appendEgressAuditReceiptWithRetention = (
  db: Database,
  receipt: EgressAuditReceiptInput,
  policy: EgressAuditRetentionPolicy,
  nowMs: number
): StoreResult<RetrievalTraceAppendResult> => {
  const prior = readSecureDelete(db);
  try {
    validateReceipt(receipt);
    validateRetention(policy, nowMs);
    db.exec("PRAGMA secure_delete = ON");
    const transaction = db.transaction((): RetrievalTraceAppendResult => {
      const appended = appendEgressAuditReceipt(db, receipt);
      if (!appended.ok) {
        throw new Error(appended.error.message, {
          cause: appended.error.cause,
        });
      }
      const rows = db
        .query<
          { audit_id: string; created_at_ms: number; byte_size: number },
          []
        >(
          `SELECT audit_id, created_at_ms, byte_size
           FROM egress_audit_receipts
           ORDER BY created_at_ms ASC, audit_id ASC`
        )
        .all();
      let remainingReceipts = rows.length;
      let remainingBytes = rows.reduce(
        (total, row) => total + row.byte_size,
        0
      );
      const ageBoundary = nowMs - policy.maxAgeDays * DAY_MS;
      for (const row of rows) {
        if (
          row.created_at_ms > ageBoundary &&
          remainingReceipts <= policy.maxReceipts &&
          remainingBytes <= policy.maxBytes
        ) {
          break;
        }
        db.run("DELETE FROM egress_audit_receipts WHERE audit_id = ?", [
          row.audit_id,
        ]);
        remainingReceipts -= 1;
        remainingBytes -= row.byte_size;
      }
      return appended.value;
    });
    return ok(transaction());
  } catch (cause) {
    return err(
      "QUERY_FAILED",
      cause instanceof Error
        ? cause.message
        : "Failed to atomically append egress audit",
      cause
    );
  } finally {
    restoreSecureDelete(db, prior);
  }
};

export const listEgressAuditReceipts = (
  db: Database,
  limit: number,
  cursor?: EgressAuditCursor
): StoreResult<EgressAuditPage> => {
  try {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new RangeError(`Egress audit limit must be from 1 to ${MAX_LIMIT}`);
    }
    if (
      cursor &&
      (!Number.isSafeInteger(cursor.createdAtMs) ||
        cursor.createdAtMs < 0 ||
        cursor.auditId.length < 1 ||
        cursor.auditId.length > 128)
    ) {
      throw new RangeError("Invalid egress audit cursor");
    }
    const rows = cursor
      ? db
          .query<DbAuditRow, [number, number, string, number]>(
            `SELECT * FROM egress_audit_receipts
             WHERE created_at_ms < ?
                OR (created_at_ms = ? AND audit_id < ?)
             ORDER BY created_at_ms DESC, audit_id DESC LIMIT ?`
          )
          .all(
            cursor.createdAtMs,
            cursor.createdAtMs,
            cursor.auditId,
            limit + 1
          )
      : db
          .query<DbAuditRow, [number]>(
            `SELECT * FROM egress_audit_receipts
             ORDER BY created_at_ms DESC, audit_id DESC LIMIT ?`
          )
          .all(limit + 1);
    const selected = rows.slice(0, limit).map(mapRow);
    const last = selected.at(-1);
    return ok({
      receipts: selected,
      nextCursor:
        rows.length > limit && last
          ? { createdAtMs: last.createdAtMs, auditId: last.auditId }
          : null,
    });
  } catch (cause) {
    return err(
      cause instanceof RangeError ? "INVALID_INPUT" : "QUERY_FAILED",
      cause instanceof Error ? cause.message : "Failed to list egress audits",
      cause
    );
  }
};

export const getEgressAuditReceipt = (
  db: Database,
  auditId: string
): StoreResult<EgressAuditReceiptRow | null> => {
  try {
    if (auditId.length < 1 || auditId.length > 128) {
      throw new RangeError("Invalid egress audit ID");
    }
    const row = db
      .query<DbAuditRow, [string]>(
        "SELECT * FROM egress_audit_receipts WHERE audit_id = ?"
      )
      .get(auditId);
    return ok(row ? mapRow(row) : null);
  } catch (cause) {
    return err(
      cause instanceof RangeError ? "INVALID_INPUT" : "QUERY_FAILED",
      cause instanceof Error ? cause.message : "Failed to get egress audit",
      cause
    );
  }
};

const checkpointAfterDelete = (
  db: Database,
  deleted: number
): Omit<EgressAuditPurgeResult, "deleted"> & { deleted: number } => {
  try {
    const checkpoint =
      db
        .query<{ busy: number; log: number; checkpointed: number }, []>(
          "PRAGMA wal_checkpoint(TRUNCATE)"
        )
        .get() ?? undefined;
    return {
      deleted,
      physicalCleanup:
        checkpoint?.busy === 0 &&
        (checkpoint.log === 0 || checkpoint.log === -1)
          ? "completed"
          : "wal_busy",
      checkpointedFrames: checkpoint?.checkpointed ?? 0,
      remainingWalFrames: checkpoint?.log ?? -1,
    };
  } catch {
    return {
      deleted,
      physicalCleanup: "failed",
      checkpointedFrames: 0,
      remainingWalFrames: -1,
    };
  }
};

export const deleteEgressAuditReceipt = (
  db: Database,
  auditId: string
): StoreResult<EgressAuditDeleteResult> => {
  const prior = readSecureDelete(db);
  try {
    if (auditId.length < 1 || auditId.length > 128) {
      throw new RangeError("Invalid egress audit ID");
    }
    db.exec("PRAGMA secure_delete = ON");
    const deleted = db.run(
      "DELETE FROM egress_audit_receipts WHERE audit_id = ?",
      [auditId]
    ).changes;
    return ok({ auditId, ...checkpointAfterDelete(db, deleted) });
  } catch (cause) {
    return err(
      cause instanceof RangeError ? "INVALID_INPUT" : "QUERY_FAILED",
      cause instanceof Error ? cause.message : "Failed to delete egress audit",
      cause
    );
  } finally {
    restoreSecureDelete(db, prior);
  }
};

export const getEgressAuditStatus = (
  db: Database
): StoreResult<EgressAuditStatusResult> => {
  try {
    const row = db
      .query<
        {
          receipts: number;
          bytes: number | null;
          oldest_created_at_ms: number | null;
          newest_created_at_ms: number | null;
        },
        []
      >(
        `SELECT COUNT(*) AS receipts,
                SUM(byte_size) AS bytes,
                MIN(created_at_ms) AS oldest_created_at_ms,
                MAX(created_at_ms) AS newest_created_at_ms
         FROM egress_audit_receipts`
      )
      .get();
    return ok({
      receipts: row?.receipts ?? 0,
      bytes: row?.bytes ?? 0,
      oldestCreatedAtMs: row?.oldest_created_at_ms ?? null,
      newestCreatedAtMs: row?.newest_created_at_ms ?? null,
    });
  } catch (cause) {
    return err(
      "QUERY_FAILED",
      cause instanceof Error ? cause.message : "Failed to inspect egress audit",
      cause
    );
  }
};

const validateRetention = (
  policy: EgressAuditRetentionPolicy,
  nowMs: number
): void => {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(policy.maxAgeDays) ||
    policy.maxAgeDays < 1 ||
    policy.maxAgeDays > 3650 ||
    !Number.isSafeInteger(policy.maxReceipts) ||
    policy.maxReceipts < 1 ||
    policy.maxReceipts > 1_000_000 ||
    !Number.isSafeInteger(policy.maxBytes) ||
    policy.maxBytes < 1 ||
    policy.maxBytes > 1024 * 1024 * 1024
  ) {
    throw new RangeError("Invalid egress audit retention policy");
  }
};

export const enforceEgressAuditRetention = (
  db: Database,
  policy: EgressAuditRetentionPolicy,
  nowMs: number
): StoreResult<EgressAuditRetentionResult> => {
  const prior = readSecureDelete(db);
  try {
    validateRetention(policy, nowMs);
    db.exec("PRAGMA secure_delete = ON");
    const transaction = db.transaction((): EgressAuditRetentionResult => {
      const rows = db
        .query<
          { audit_id: string; created_at_ms: number; byte_size: number },
          []
        >(
          `SELECT audit_id, created_at_ms, byte_size
           FROM egress_audit_receipts
           ORDER BY created_at_ms ASC, audit_id ASC`
        )
        .all();
      let remainingReceipts = rows.length;
      let remainingBytes = rows.reduce(
        (total, row) => total + row.byte_size,
        0
      );
      let deleted = 0;
      const ageBoundary = nowMs - policy.maxAgeDays * DAY_MS;
      for (const row of rows) {
        if (
          row.created_at_ms > ageBoundary &&
          remainingReceipts <= policy.maxReceipts &&
          remainingBytes <= policy.maxBytes
        ) {
          break;
        }
        db.run("DELETE FROM egress_audit_receipts WHERE audit_id = ?", [
          row.audit_id,
        ]);
        deleted += 1;
        remainingReceipts -= 1;
        remainingBytes -= row.byte_size;
      }
      return { deleted, remainingReceipts, remainingBytes };
    });
    return ok(transaction());
  } catch (cause) {
    return err(
      cause instanceof RangeError ? "INVALID_INPUT" : "QUERY_FAILED",
      cause instanceof Error
        ? cause.message
        : "Failed to enforce egress audit retention",
      cause
    );
  } finally {
    restoreSecureDelete(db, prior);
  }
};

export const purgeEgressAuditReceipts = (
  db: Database
): StoreResult<EgressAuditPurgeResult> => {
  const prior = readSecureDelete(db);
  try {
    db.exec("PRAGMA secure_delete = ON");
    const deleted = db.transaction(
      () => db.run("DELETE FROM egress_audit_receipts").changes
    )();
    return ok(checkpointAfterDelete(db, deleted));
  } catch (cause) {
    return err(
      "QUERY_FAILED",
      cause instanceof Error ? cause.message : "Failed to purge egress audits",
      cause
    );
  } finally {
    restoreSecureDelete(db, prior);
  }
};
