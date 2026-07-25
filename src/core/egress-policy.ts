import {
  EGRESS_POLICIES,
  EGRESS_POLICY_SOURCES,
  type EgressPolicy,
  type EgressPolicySource,
} from "../config/types";

export const EGRESS_ACTIONS = [
  "retrieve",
  "serve",
  "publish",
  "remote_inference",
  "export",
  "clip_write",
] as const;
export type EgressAction = (typeof EGRESS_ACTIONS)[number];

export const EGRESS_DESTINATION_ZONES = [
  "local_process",
  "loopback",
  "lan",
  "remote",
] as const;
export type EgressDestinationZone = (typeof EGRESS_DESTINATION_ZONES)[number];

/**
 * Source and derived classes retain the same collection-owned policy.
 * Transformation never declassifies indexed content.
 */
export const EGRESS_CONTENT_CLASSES = [
  "source",
  "snippet",
  "metadata",
  "attachment",
  "embedding",
  "capsule",
  "audit_log",
  "retrieval_trace",
] as const;
export type EgressContentClass = (typeof EGRESS_CONTENT_CLASSES)[number];

export const EGRESS_REASON_CODES = [
  "LOCAL_DESTINATION",
  "LAN_POLICY_AUTHENTICATED",
  "REMOTE_POLICY_AUTHENTICATED",
  "INVALID_INPUT",
  "NO_COLLECTION_POLICY",
  "INVALID_COLLECTION",
  "UNKNOWN_ACTION",
  "UNKNOWN_DESTINATION",
  "ACTION_DESTINATION_MISMATCH",
  "UNKNOWN_CONTENT_CLASS",
  "UNKNOWN_POLICY",
  "UNKNOWN_POLICY_SOURCE",
  "INVALID_CALLER",
  "CALLER_NOT_AUTHORIZED",
  "AUTHENTICATION_REQUIRED",
  "POLICY_LOCAL_ONLY",
  "POLICY_LAN_ONLY",
] as const;
export type EgressReasonCode = (typeof EGRESS_REASON_CODES)[number];

export interface CollectionEgressState {
  /** Stable configured collection identifier; never a filesystem path. */
  collection: string;
  policy: EgressPolicy;
  source: EgressPolicySource;
}

export interface EgressCallerContext {
  /**
   * Transport or feature authentication succeeded. Network destinations
   * always require this; policy cannot make authentication optional.
   */
  authenticated: boolean;
  /**
   * The surrounding authorization layer permits this operation. A false value
   * narrows access even for a policy that would otherwise allow it.
   */
  operationAuthorized: boolean;
}

export interface EgressDestination {
  zone: EgressDestinationZone;
  /**
   * Optional classifier inputs are deliberately excluded from decisions and
   * audit metadata so hosts, provider names, and credentials cannot leak.
   */
  host?: string;
  provider?: string;
}

export interface EgressEvaluationInput {
  collections: readonly CollectionEgressState[];
  action: EgressAction;
  destination: EgressDestination;
  caller: EgressCallerContext;
  contentClass: EgressContentClass;
}

export interface EgressDecisionMetadata {
  action: EgressAction | "unknown";
  destinationZone: EgressDestinationZone | "unknown";
  contentClass: EgressContentClass | "unknown";
  collectionCount: number;
  collections: readonly string[];
  effectivePolicy: EgressPolicy | "unknown";
  effectivePolicySource: EgressPolicySource | "mixed" | "unknown";
  callerAuthenticated: boolean | null;
  callerOperationAuthorized: boolean | null;
}

export interface EgressDecision {
  allowed: boolean;
  code: "EGRESS_ALLOWED" | "EGRESS_DENIED";
  reason: EgressReasonCode;
  audit: EgressDecisionMetadata;
}

export interface EgressPolicyPort {
  evaluate(input: EgressEvaluationInput): EgressDecision;
}

const ACTIONS = new Set<unknown>(EGRESS_ACTIONS);
const DESTINATION_ZONES = new Set<unknown>(EGRESS_DESTINATION_ZONES);
const CONTENT_CLASSES = new Set<unknown>(EGRESS_CONTENT_CLASSES);
const POLICIES = new Set<unknown>(EGRESS_POLICIES);
const POLICY_SOURCES = new Set<unknown>(EGRESS_POLICY_SOURCES);
const COLLECTION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const POLICY_ORDER: Record<EgressPolicy, number> = {
  local_only: 0,
  lan: 1,
  remote: 2,
};

const isAction = (value: unknown): value is EgressAction => ACTIONS.has(value);
const isDestinationZone = (value: unknown): value is EgressDestinationZone =>
  DESTINATION_ZONES.has(value);
const isContentClass = (value: unknown): value is EgressContentClass =>
  CONTENT_CLASSES.has(value);
const isPolicy = (value: unknown): value is EgressPolicy => POLICIES.has(value);
const isPolicySource = (value: unknown): value is EgressPolicySource =>
  POLICY_SOURCES.has(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function createAudit(input: unknown): EgressDecisionMetadata {
  const record = isRecord(input) ? input : {};
  const destination = isRecord(record.destination) ? record.destination : {};
  const caller = isRecord(record.caller) ? record.caller : {};
  const rawCollections = Array.isArray(record.collections)
    ? record.collections
    : [];
  const collections = rawCollections
    .map((collection) =>
      isRecord(collection) &&
      typeof collection.collection === "string" &&
      COLLECTION_NAME_PATTERN.test(collection.collection)
        ? collection.collection
        : "unknown"
    )
    .sort();
  return {
    action: isAction(record.action) ? record.action : "unknown",
    destinationZone: isDestinationZone(destination.zone)
      ? destination.zone
      : "unknown",
    contentClass: isContentClass(record.contentClass)
      ? record.contentClass
      : "unknown",
    collectionCount: rawCollections.length,
    collections,
    effectivePolicy: "unknown",
    effectivePolicySource: "unknown",
    callerAuthenticated:
      typeof caller.authenticated === "boolean" ? caller.authenticated : null,
    callerOperationAuthorized:
      typeof caller.operationAuthorized === "boolean"
        ? caller.operationAuthorized
        : null,
  };
}

function decision(
  allowed: boolean,
  reason: EgressReasonCode,
  audit: EgressDecisionMetadata
): EgressDecision {
  return {
    allowed,
    code: allowed ? "EGRESS_ALLOWED" : "EGRESS_DENIED",
    reason,
    audit,
  };
}

function effectiveCollectionPolicy(
  collections: readonly CollectionEgressState[]
): {
  policy: EgressPolicy;
  source: EgressPolicySource | "mixed";
} {
  let policy: EgressPolicy = "remote";
  for (const collection of collections) {
    if (POLICY_ORDER[collection.policy] < POLICY_ORDER[policy]) {
      policy = collection.policy;
    }
  }

  const restrictiveSources = new Set(
    collections
      .filter((collection) => collection.policy === policy)
      .map((collection) => collection.source)
  );
  const source =
    restrictiveSources.size === 1
      ? (restrictiveSources.values().next().value ?? "mixed")
      : "mixed";
  return { policy, source };
}

function actionAllowsDestination(
  action: EgressAction,
  destination: EgressDestinationZone
): boolean {
  switch (action) {
    case "publish":
    case "remote_inference":
      return destination === "remote";
    case "serve":
      return destination !== "local_process";
    case "export":
      return destination !== "loopback";
    case "retrieve":
    case "clip_write":
      return true;
  }
}

/**
 * Evaluate one content-transfer boundary. Runtime guards intentionally accept
 * malformed JavaScript callers fail-closed even though TypeScript callers get
 * the narrower contract.
 */
export function evaluateEgressPolicy(
  input: EgressEvaluationInput | null | undefined
): EgressDecision {
  const audit = createAudit(input);
  if (!isRecord(input)) {
    return decision(false, "INVALID_INPUT", audit);
  }
  if (!Array.isArray(input.collections) || input.collections.length === 0) {
    return decision(false, "NO_COLLECTION_POLICY", audit);
  }
  if (!isAction(input.action)) {
    return decision(false, "UNKNOWN_ACTION", audit);
  }
  if (
    !isRecord(input.destination) ||
    !isDestinationZone(input.destination.zone)
  ) {
    return decision(false, "UNKNOWN_DESTINATION", audit);
  }
  if (!actionAllowsDestination(input.action, input.destination.zone)) {
    return decision(false, "ACTION_DESTINATION_MISMATCH", audit);
  }
  if (!isContentClass(input.contentClass)) {
    return decision(false, "UNKNOWN_CONTENT_CLASS", audit);
  }
  if (
    !isRecord(input.caller) ||
    typeof input.caller.authenticated !== "boolean" ||
    typeof input.caller.operationAuthorized !== "boolean"
  ) {
    return decision(false, "INVALID_CALLER", audit);
  }

  for (const collection of input.collections) {
    if (
      !isRecord(collection) ||
      typeof collection.collection !== "string" ||
      !COLLECTION_NAME_PATTERN.test(collection.collection)
    ) {
      return decision(false, "INVALID_COLLECTION", audit);
    }
    if (!isPolicy(collection?.policy)) {
      return decision(false, "UNKNOWN_POLICY", audit);
    }
    if (!isPolicySource(collection?.source)) {
      return decision(false, "UNKNOWN_POLICY_SOURCE", audit);
    }
  }

  const effective = effectiveCollectionPolicy(input.collections);
  audit.effectivePolicy = effective.policy;
  audit.effectivePolicySource = effective.source;

  if (!input.caller.operationAuthorized) {
    return decision(false, "CALLER_NOT_AUTHORIZED", audit);
  }
  if (
    input.destination.zone === "local_process" ||
    input.destination.zone === "loopback"
  ) {
    return decision(true, "LOCAL_DESTINATION", audit);
  }
  if (effective.policy === "local_only") {
    return decision(false, "POLICY_LOCAL_ONLY", audit);
  }
  if (input.destination.zone === "remote" && effective.policy === "lan") {
    return decision(false, "POLICY_LAN_ONLY", audit);
  }
  if (!input.caller.authenticated) {
    return decision(false, "AUTHENTICATION_REQUIRED", audit);
  }
  if (input.destination.zone === "lan") {
    return decision(true, "LAN_POLICY_AUTHENTICATED", audit);
  }
  return decision(true, "REMOTE_POLICY_AUTHENTICATED", audit);
}

export const defaultEgressPolicyPort: EgressPolicyPort = Object.freeze({
  evaluate: evaluateEgressPolicy,
});
