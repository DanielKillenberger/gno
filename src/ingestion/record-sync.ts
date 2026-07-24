import type { StoredRecordState } from "../store/types";
import type { CanonicalRecord, RecordAdapterRunResult } from "./record-adapter";

export type RecordSyncAction =
  | { type: "add"; record: CanonicalRecord }
  | { type: "update"; previous: StoredRecordState; record: CanonicalRecord }
  | {
      type: "reactivate";
      previous: StoredRecordState;
      record: CanonicalRecord;
    }
  | { type: "unchanged"; previous: StoredRecordState; record?: CanonicalRecord }
  | { type: "deactivate"; previous: StoredRecordState }
  | { type: "preserve"; previous: StoredRecordState };

export interface RecordSyncPlan {
  authoritative: boolean;
  actions: RecordSyncAction[];
}

/**
 * Pure snapshot reconciliation. Persistence/transactions are intentionally
 * deferred until the virtual-record lineage schema exists.
 */
export function reconcileRecordSnapshot(
  priorRecords: readonly StoredRecordState[],
  snapshot: RecordAdapterRunResult
): RecordSyncPlan {
  const priorByKey = new Map(
    priorRecords.map((record) => [record.recordKey, record])
  );
  const seen = new Set<string>();
  const failed = new Set(snapshot.failedRecordKeys);
  const actions: RecordSyncAction[] = [];

  for (const record of snapshot.records) {
    seen.add(record.recordKey);
    const previous = priorByKey.get(record.recordKey);
    if (!previous) {
      actions.push({ type: "add", record });
      continue;
    }
    if (!previous.active) {
      actions.push({ type: "reactivate", previous, record });
      continue;
    }
    if (
      previous.sourceHash === record.sourceHash &&
      previous.adapterVersion === record.adapterVersion
    ) {
      actions.push({ type: "unchanged", previous, record });
      continue;
    }
    actions.push({ type: "update", previous, record });
  }

  for (const previous of priorRecords) {
    if (seen.has(previous.recordKey)) continue;
    if (failed.has(previous.recordKey) || !snapshot.authoritative) {
      actions.push({ type: "preserve", previous });
    } else if (previous.active) {
      actions.push({ type: "deactivate", previous });
    } else {
      actions.push({ type: "unchanged", previous });
    }
  }

  return { authoritative: snapshot.authoritative, actions };
}
