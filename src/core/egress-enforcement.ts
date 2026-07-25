/** Shared fail-closed enforcement helpers for content-transfer boundaries. */

import type { Collection } from "../config/types";
import type { StorePort } from "../store/types";
import type {
  EgressAction,
  EgressCallerContext,
  EgressContentClass,
  EgressDecision,
  EgressDestinationZone,
} from "./egress-policy";
import type { EgressLineage } from "./egress-provenance";

import { resolveConfiguredEgressPolicy } from "../config/types";
import { EgressAuditService } from "./egress-audit";
import { evaluateEgressPolicy } from "./egress-policy";
import { resolveEgressLineage } from "./egress-provenance";

export const EGRESS_DENIED_MESSAGE =
  "Operation blocked by collection egress policy";

export class EgressDeniedError extends Error {
  readonly code = "EGRESS_DENIED";
  readonly decision: EgressDecision;

  constructor(decision: EgressDecision) {
    super(`${decision.code}: ${EGRESS_DENIED_MESSAGE}`);
    this.name = "EgressDeniedError";
    this.decision = decision;
    this.stack = `${this.name}: ${this.message}`;
  }

  toJSON(): {
    code: "EGRESS_DENIED";
    message: string;
    reason: EgressDecision["reason"];
    audit: EgressDecision["audit"];
  } {
    return {
      code: this.code,
      message: EGRESS_DENIED_MESSAGE,
      reason: this.decision.reason,
      audit: this.decision.audit,
    };
  }
}

export const collectionEgressStates = (
  collections: readonly Collection[],
  names?: readonly string[]
) => {
  return resolveEgressLineage(
    collections.map((collection) => {
      const effective = resolveConfiguredEgressPolicy(collection);
      return {
        collection: collection.name,
        policy: effective.policy,
        source: effective.source,
      };
    }),
    names
  ).sources;
};

export interface EnforceCollectionEgressInput {
  collections: readonly Collection[];
  collectionNames?: readonly string[];
  action: EgressAction;
  destinationZone: EgressDestinationZone;
  caller: EgressCallerContext;
  contentClass: EgressContentClass;
}

export interface MixedCollectionEgressPlan {
  mode: "complete" | "partial";
  sourceLineage: EgressLineage;
  allowedCollections: string[];
  omittedCollections: Array<{
    collection: string;
    reason: EgressDecision["reason"];
  }>;
  disclosure: null | {
    code: "EGRESS_PARTIAL_RESULT";
    omittedCount: number;
    omittedCollections: string[];
  };
}

/**
 * Plan one mixed-source boundary. Denial is the default; partial emission
 * requires an explicit caller opt-in and always discloses sorted omissions.
 */
export const planCollectionEgress = (
  input: EnforceCollectionEgressInput & {
    partialResults?: "deny" | "explicit";
  }
): MixedCollectionEgressPlan => {
  const sourceLineage = resolveEgressLineage(
    input.collections.map((collection) => {
      const effective = resolveConfiguredEgressPolicy(collection);
      return {
        collection: collection.name,
        policy: effective.policy,
        source: effective.source,
      };
    }),
    input.collectionNames
  );
  const aggregate = evaluateEgressPolicy({
    collections: sourceLineage.sources,
    action: input.action,
    destination: { zone: input.destinationZone },
    caller: input.caller,
    contentClass: input.contentClass,
  });
  if (aggregate.allowed) {
    return {
      mode: "complete",
      sourceLineage,
      allowedCollections: sourceLineage.sources.map(
        ({ collection }) => collection
      ),
      omittedCollections: [],
      disclosure: null,
    };
  }
  if (input.partialResults !== "explicit") {
    throw new EgressDeniedError(aggregate);
  }

  const allowedCollections: string[] = [];
  const omittedCollections: MixedCollectionEgressPlan["omittedCollections"] =
    [];
  for (const source of sourceLineage.sources) {
    const perCollection = evaluateEgressPolicy({
      collections: [source],
      action: input.action,
      destination: { zone: input.destinationZone },
      caller: input.caller,
      contentClass: input.contentClass,
    });
    if (perCollection.allowed) allowedCollections.push(source.collection);
    else {
      omittedCollections.push({
        collection: source.collection,
        reason: perCollection.reason,
      });
    }
  }
  if (allowedCollections.length === 0) {
    throw new EgressDeniedError(aggregate);
  }
  return {
    mode: "partial",
    sourceLineage,
    allowedCollections,
    omittedCollections,
    disclosure: {
      code: "EGRESS_PARTIAL_RESULT",
      omittedCount: omittedCollections.length,
      omittedCollections: omittedCollections.map(
        ({ collection }) => collection
      ),
    },
  };
};

export const enforceCollectionEgress = (
  input: EnforceCollectionEgressInput
): EgressDecision => {
  const plan = planCollectionEgress(input);
  const decision = evaluateEgressPolicy({
    collections: plan.sourceLineage.sources,
    action: input.action,
    destination: { zone: input.destinationZone },
    caller: input.caller,
    contentClass: input.contentClass,
  });
  if (!decision.allowed) throw new EgressDeniedError(decision);
  return decision;
};

/** Enforce and durably record the content-free decision before transfer. */
export const enforceCollectionEgressWithAudit = async (
  input: EnforceCollectionEgressInput & { store: StorePort }
): Promise<{ decision: EgressDecision; lineage: EgressLineage }> => {
  const lineage = resolveEgressLineage(
    input.collections.map((collection) => {
      const effective = resolveConfiguredEgressPolicy(collection);
      return {
        collection: collection.name,
        policy: effective.policy,
        source: effective.source,
      };
    }),
    input.collectionNames
  );
  let decision: EgressDecision;
  let denied: EgressDeniedError | null = null;
  try {
    decision = enforceCollectionEgress(input);
  } catch (error) {
    if (!(error instanceof EgressDeniedError)) throw error;
    decision = error.decision;
    denied = error;
  }
  const recorded = await new EgressAuditService(input.store).record({
    decision,
    lineage,
    contentClass: input.contentClass,
  });
  if (!recorded.ok) {
    throw new Error(`Failed to record egress audit: ${recorded.error.code}`);
  }
  if (denied) throw denied;
  return { decision, lineage };
};

export const maximumDestinationZoneForCollections = (
  collections: readonly Collection[],
  names?: readonly string[]
): Exclude<EgressDestinationZone, "local_process"> => {
  const states = collectionEgressStates(collections, names);
  if (states.some(({ policy }) => policy === "local_only")) return "loopback";
  if (states.some(({ policy }) => policy === "lan")) return "lan";
  return "remote";
};
