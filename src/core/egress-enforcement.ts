/** Shared fail-closed enforcement helpers for content-transfer boundaries. */

import type { Collection } from "../config/types";
import type {
  EgressAction,
  EgressCallerContext,
  EgressContentClass,
  EgressDecision,
  EgressDestinationZone,
} from "./egress-policy";

import { resolveConfiguredEgressPolicy } from "../config/types";
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

export const enforceCollectionEgress = (
  input: EnforceCollectionEgressInput
): EgressDecision => {
  const decision = evaluateEgressPolicy({
    collections: collectionEgressStates(
      input.collections,
      input.collectionNames
    ),
    action: input.action,
    destination: { zone: input.destinationZone },
    caller: input.caller,
    contentClass: input.contentClass,
  });
  if (!decision.allowed) throw new EgressDeniedError(decision);
  return decision;
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
