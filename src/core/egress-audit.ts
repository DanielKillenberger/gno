/** Bounded local management service for content-free egress receipts. */

import type {
  EgressAuditPage,
  EgressAuditRetentionPolicy,
  EgressAuditRetentionResult,
  EgressAuditPurgeResult,
  StorePort,
  StoreResult,
} from "../store/types";
import type { EgressContentClass, EgressDecision } from "./egress-policy";
import type { EgressLineage } from "./egress-provenance";

import { canonicalTraceJson } from "../store/retrieval-trace-codec";
import { err, ok } from "../store/types";
import { defaultEgressPolicyPort } from "./egress-policy";
import { egressLineageSchema } from "./egress-provenance";

const CURSOR_PREFIX = "gno-egress-audit-v1.";
const DEFAULT_RETENTION: EgressAuditRetentionPolicy = {
  maxAgeDays: 30,
  maxReceipts: 10_000,
  maxBytes: 4 * 1024 * 1024,
};

const encodeCursor = (cursor: {
  createdAtMs: number;
  auditId: string;
}): string =>
  `${CURSOR_PREFIX}${new TextEncoder()
    .encode(canonicalTraceJson(cursor))
    .toBase64({ alphabet: "base64url", omitPadding: true })}`;

const decodeCursor = (
  cursor: string | undefined
): StoreResult<{ createdAtMs: number; auditId: string } | undefined> => {
  if (cursor === undefined) return ok(undefined);
  if (!cursor.startsWith(CURSOR_PREFIX)) {
    return err("INVALID_INPUT", "Invalid egress audit cursor");
  }
  try {
    const decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.fromBase64(cursor.slice(CURSOR_PREFIX.length), {
          alphabet: "base64url",
        })
      )
    ) as Record<string, unknown>;
    if (
      Object.keys(decoded).sort().join(",") !== "auditId,createdAtMs" ||
      typeof decoded.auditId !== "string" ||
      decoded.auditId.length < 1 ||
      decoded.auditId.length > 128 ||
      !Number.isSafeInteger(decoded.createdAtMs) ||
      (decoded.createdAtMs as number) < 0
    ) {
      throw new TypeError("Invalid egress audit cursor");
    }
    return ok({
      createdAtMs: decoded.createdAtMs as number,
      auditId: decoded.auditId,
    });
  } catch {
    return err("INVALID_INPUT", "Invalid egress audit cursor");
  }
};

export interface EgressAuditListResult extends Omit<
  EgressAuditPage,
  "nextCursor"
> {
  schemaVersion: "1.0";
  nextCursor: string | null;
}

export class EgressAuditService {
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(
    private readonly store: StorePort,
    deps: { clock?: () => number; idFactory?: () => string } = {}
  ) {
    this.clock = deps.clock ?? Date.now;
    this.idFactory = deps.idFactory ?? (() => crypto.randomUUID());
  }

  async record(input: {
    decision: EgressDecision;
    lineage: EgressLineage;
    contentClass: EgressContentClass;
    retention?: EgressAuditRetentionPolicy;
  }): Promise<StoreResult<"inserted" | "duplicate">> {
    const lineage = egressLineageSchema.safeParse(input.lineage);
    const audit = input.decision.audit;
    if (
      !lineage.success ||
      audit.action === "unknown" ||
      audit.destinationZone === "unknown" ||
      audit.contentClass !== input.contentClass ||
      typeof audit.callerAuthenticated !== "boolean" ||
      typeof audit.callerOperationAuthorized !== "boolean"
    ) {
      return err("INVALID_INPUT", "Invalid egress audit decision metadata");
    }
    const expected = defaultEgressPolicyPort.evaluate({
      collections: lineage.data.sources,
      action: audit.action,
      destination: { zone: audit.destinationZone },
      caller: {
        authenticated: audit.callerAuthenticated,
        operationAuthorized: audit.callerOperationAuthorized,
      },
      contentClass: input.contentClass,
    });
    if (
      canonicalTraceJson(expected) !== canonicalTraceJson(input.decision) ||
      audit.collectionCount !== lineage.data.sources.length ||
      canonicalTraceJson(audit.collections) !==
        canonicalTraceJson(
          lineage.data.sources.map(({ collection }) => collection)
        ) ||
      audit.effectivePolicy !== lineage.data.effectivePolicy
    ) {
      return err(
        "INVALID_INPUT",
        "Egress audit decision does not match its policy lineage"
      );
    }
    const retention = input.retention ?? DEFAULT_RETENTION;
    if (!this.store.appendEgressAuditReceiptWithRetention) {
      return err(
        "CONSTRAINT_VIOLATION",
        "Store cannot atomically persist bounded egress audits"
      );
    }
    const nowMs = this.clock();
    return this.store.appendEgressAuditReceiptWithRetention(
      {
        auditId: this.idFactory(),
        decision: input.decision.allowed ? "allow" : "deny",
        action: audit.action,
        destinationZone: audit.destinationZone,
        contentClass: input.contentClass,
        effectivePolicy: lineage.data.effectivePolicy,
        reasonCode: input.decision.reason,
        lineageDigest: lineage.data.digest,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + retention.maxAgeDays * 86_400_000,
      },
      retention,
      nowMs
    );
  }

  async list(
    input: {
      limit?: number;
      cursor?: string;
    } = {}
  ): Promise<StoreResult<EgressAuditListResult>> {
    const cursor = decodeCursor(input.cursor);
    if (!cursor.ok) return cursor;
    const page = await this.store.listEgressAuditReceipts(
      input.limit ?? 100,
      cursor.value
    );
    if (!page.ok) return page;
    return ok({
      schemaVersion: "1.0",
      receipts: page.value.receipts,
      nextCursor: page.value.nextCursor
        ? encodeCursor(page.value.nextCursor)
        : null,
    });
  }

  enforceRetention(
    policy: EgressAuditRetentionPolicy,
    nowMs = this.clock()
  ): Promise<StoreResult<EgressAuditRetentionResult>> {
    return this.store.enforceEgressAuditRetention(policy, nowMs);
  }

  purge(): Promise<StoreResult<EgressAuditPurgeResult>> {
    return this.store.purgeEgressAuditReceipts();
  }
}
