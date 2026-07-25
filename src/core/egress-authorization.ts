/** Shared current-policy authorization boundary for derived artifacts. */

import type { Collection } from "../config/types";
import type { StorePort, StoreResult } from "../store/types";
import type {
  EgressAction,
  EgressCallerContext,
  EgressContentClass,
  EgressDestinationZone,
} from "./egress-policy";
import type { EgressLineage } from "./egress-provenance";

import { err, ok } from "../store/types";
import { currentEgressSources } from "./collection-egress-policy-service";
import { EgressAuditService } from "./egress-audit";
import { evaluateEgressPolicy } from "./egress-policy";
import { resolveEgressLineage } from "./egress-provenance";

export const authorizeCurrentEgress = async (input: {
  store: StorePort;
  config: { collections: readonly Collection[] };
  lineage: EgressLineage;
  action: EgressAction;
  destinationZone: EgressDestinationZone;
  caller: EgressCallerContext;
  contentClass: EgressContentClass;
}): Promise<StoreResult<EgressLineage>> => {
  const currentLineage = resolveEgressLineage(
    currentEgressSources(
      input.config,
      input.lineage.sources.map(({ collection }) => collection)
    )
  );
  const decision = evaluateEgressPolicy({
    collections: currentLineage.sources,
    action: input.action,
    destination: { zone: input.destinationZone },
    caller: input.caller,
    contentClass: input.contentClass,
  });
  const recorded = await new EgressAuditService(input.store).record({
    decision,
    lineage: currentLineage,
    contentClass: input.contentClass,
  });
  if (!recorded.ok) return recorded;
  return decision.allowed
    ? ok(currentLineage)
    : err("EGRESS_DENIED", "Operation blocked by collection egress policy");
};
