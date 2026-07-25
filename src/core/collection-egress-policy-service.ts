/** Shared collection egress policy management and explanation contract. */

import type { Config, EgressPolicy, EgressPolicySource } from "../config/types";
import type { ApplyConfigResult, MutationResult } from "./config-mutation";
import type {
  EgressAction,
  EgressCallerContext,
  EgressContentClass,
  EgressDecision,
  EgressDestinationZone,
} from "./egress-policy";

import { resolveConfiguredEgressPolicy } from "../config/types";
import { hashTraceCanonical } from "../store/retrieval-trace-codec";
import { EgressDeniedError, planCollectionEgress } from "./egress-enforcement";
import { evaluateEgressPolicy } from "./egress-policy";
import { resolveEgressLineage } from "./egress-provenance";

const POLICY_ORDER: Readonly<Record<EgressPolicy, number>> = {
  local_only: 0,
  lan: 1,
  remote: 2,
};

export interface CollectionEgressPolicyState {
  schemaVersion: "1.0";
  collection: string;
  configuredPolicy: EgressPolicy | null;
  effectivePolicy: EgressPolicy;
  source: Extract<EgressPolicySource, "explicit" | "config_default">;
  version: string;
}

export interface EgressRelaxationConfirmation {
  currentPolicy: EgressPolicy;
  currentVersion: string;
  acknowledged: true;
}

export interface CollectionEgressPolicySetResult {
  schemaVersion: "1.0";
  previous: CollectionEgressPolicyState;
  current: CollectionEgressPolicyState;
  change: "tightened" | "relaxed" | "unchanged";
  invalidation: null | {
    policyEpoch: string;
    queuedJobsInvalidated: number;
    sessionsInvalidated: number;
    staleWorkMustRetry: true;
  };
}

export interface CollectionEgressCheckInput {
  collections?: readonly string[];
  action: EgressAction;
  destinationZone: EgressDestinationZone;
  caller: EgressCallerContext;
  contentClass: EgressContentClass;
  partialResults?: "deny" | "explicit";
}

export interface CollectionEgressCheckResult {
  schemaVersion: "1.0";
  mode: "complete" | "partial" | "denied";
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
  lineage: ReturnType<typeof resolveEgressLineage>;
  decision: EgressDecision;
  remediation: null | {
    code: EgressDecision["reason"];
    message: string;
  };
}

export interface CollectionEgressPolicyServiceDeps {
  getConfig: () => Config;
  mutateConfig?: (
    mutate: (config: Config) => MutationResult<CollectionEgressPolicySetResult>
  ) => Promise<ApplyConfigResult<CollectionEgressPolicySetResult>>;
  onPolicyChanged?: (
    result: CollectionEgressPolicySetResult
  ) =>
    | Promise<NonNullable<CollectionEgressPolicySetResult["invalidation"]>>
    | NonNullable<CollectionEgressPolicySetResult["invalidation"]>;
}

const stateVersion = (input: {
  collection: string;
  effectivePolicy: EgressPolicy;
  source: EgressPolicySource;
}): string =>
  `egress-policy-v1:${hashTraceCanonical({
    collection: input.collection,
    effectivePolicy: input.effectivePolicy,
    source: input.source,
  })}`;

export const collectionEgressPolicyEpoch = (config: Config): string =>
  `egress-epoch-v1:${hashTraceCanonical(
    config.collections
      .map((collection) => {
        const effective = resolveConfiguredEgressPolicy(collection);
        return {
          collection: collection.name,
          policy: effective.policy,
          source: effective.source,
        };
      })
      .sort((left, right) => left.collection.localeCompare(right.collection))
  )}`;

/** Rebind immutable source membership to current policies at execution time. */
export const currentEgressSources = (
  config: { collections: readonly Config["collections"][number][] },
  collectionNames: readonly string[]
) =>
  collectionNames.map((name) => {
    const collection = config.collections.find(
      (candidate) => candidate.name === name
    );
    const effective = collection
      ? resolveConfiguredEgressPolicy(collection)
      : {
          policy: "local_only" as const,
          source: "legacy_default" as const,
        };
    return {
      collection: name,
      policy: effective.policy,
      source: effective.source,
    };
  });

const policyState = (
  config: Config,
  name: string
): CollectionEgressPolicyState | null => {
  const collection = config.collections.find(
    (candidate) => candidate.name === name.toLowerCase()
  );
  if (!collection) return null;
  const effective = resolveConfiguredEgressPolicy(collection);
  return {
    schemaVersion: "1.0",
    collection: collection.name,
    configuredPolicy: collection.egressPolicy ?? null,
    effectivePolicy: effective.policy,
    source: effective.source,
    version: stateVersion({
      collection: collection.name,
      effectivePolicy: effective.policy,
      source: effective.source,
    }),
  };
};

const remediationFor = (
  decision: EgressDecision
): CollectionEgressCheckResult["remediation"] => {
  if (decision.allowed) return null;
  const messages: Partial<Record<EgressDecision["reason"], string>> = {
    AUTHENTICATION_REQUIRED:
      "Authenticate the destination without changing collection policy.",
    CALLER_NOT_AUTHORIZED:
      "Authorize this operation separately from collection policy.",
    POLICY_LOCAL_ONLY:
      "Keep the action local or explicitly relax every source collection.",
    POLICY_LAN_ONLY:
      "Use an authenticated LAN destination or explicitly allow remote egress.",
  };
  return {
    code: decision.reason,
    message:
      messages[decision.reason] ??
      "Correct the action, destination, caller, content class, or collection scope.",
  };
};

export class CollectionEgressPolicyService {
  constructor(private readonly deps: CollectionEgressPolicyServiceDeps) {}

  get(name: string): CollectionEgressPolicyState | null {
    return policyState(this.deps.getConfig(), name);
  }

  async set(input: {
    collection: string;
    policy: EgressPolicy;
    confirmation?: EgressRelaxationConfirmation;
  }): Promise<
    | { ok: true; value: CollectionEgressPolicySetResult }
    | { ok: false; code: string; error: string }
  > {
    if (!this.deps.mutateConfig) {
      return {
        ok: false,
        code: "READ_ONLY",
        error: "Collection policy mutation is not available",
      };
    }
    const changed = await this.deps.mutateConfig((config) => {
      const previous = policyState(config, input.collection);
      if (!previous) {
        return {
          ok: false,
          code: "NOT_FOUND",
          error: `Collection not found: ${input.collection}`,
        };
      }
      const orderDelta =
        POLICY_ORDER[input.policy] - POLICY_ORDER[previous.effectivePolicy];
      if (
        orderDelta > 0 &&
        (input.confirmation?.acknowledged !== true ||
          input.confirmation.currentPolicy !== previous.effectivePolicy ||
          input.confirmation.currentVersion !== previous.version)
      ) {
        return {
          ok: false,
          code: "EGRESS_RELAXATION_CONFIRMATION_REQUIRED",
          error:
            "Relaxing collection egress requires confirmation bound to the current policy version",
        };
      }
      const collections = config.collections.map((collection) =>
        collection.name === previous.collection
          ? { ...collection, egressPolicy: input.policy }
          : collection
      );
      const nextConfig = { ...config, collections };
      const current = policyState(nextConfig, previous.collection);
      if (!current) {
        return {
          ok: false,
          code: "NOT_FOUND",
          error: `Collection not found: ${input.collection}`,
        };
      }
      return {
        ok: true,
        config: nextConfig,
        value: {
          schemaVersion: "1.0",
          previous,
          current,
          change:
            orderDelta > 0
              ? "relaxed"
              : orderDelta < 0
                ? "tightened"
                : "unchanged",
          invalidation: null,
        },
      };
    });
    if (!changed.ok) return changed;
    const value = changed.value;
    if (!value) {
      return {
        ok: false,
        code: "RUNTIME",
        error: "Policy mutation returned no result",
      };
    }
    if (value.change !== "unchanged") {
      const invalidation = await this.deps.onPolicyChanged?.(value);
      value.invalidation = invalidation ?? {
        policyEpoch: collectionEgressPolicyEpoch(changed.config),
        queuedJobsInvalidated: 0,
        sessionsInvalidated: 0,
        staleWorkMustRetry: true,
      };
    }
    return { ok: true, value };
  }

  check(input: CollectionEgressCheckInput): CollectionEgressCheckResult {
    const config = this.deps.getConfig();
    const names =
      input.collections ??
      config.collections
        .map(({ name }) => name)
        .sort((a, b) => a.localeCompare(b));
    const sources = names.map((name) => {
      const state = policyState(config, name);
      if (!state) {
        return {
          collection: name,
          policy: "local_only" as const,
          source: "legacy_default" as const,
        };
      }
      return {
        collection: state.collection,
        policy: state.effectivePolicy,
        source: state.source,
      };
    });
    const lineage = resolveEgressLineage(sources, names);
    const decision = evaluateEgressPolicy({
      collections: lineage.sources,
      action: input.action,
      destination: { zone: input.destinationZone },
      caller: input.caller,
      contentClass: input.contentClass,
    });
    try {
      const plan = planCollectionEgress({
        collections: config.collections,
        collectionNames: names,
        action: input.action,
        destinationZone: input.destinationZone,
        caller: input.caller,
        contentClass: input.contentClass,
        partialResults: input.partialResults,
      });
      return {
        schemaVersion: "1.0",
        mode: plan.mode,
        allowedCollections: plan.allowedCollections,
        omittedCollections: plan.omittedCollections,
        disclosure: plan.disclosure,
        lineage,
        decision,
        remediation: remediationFor(decision),
      };
    } catch (error) {
      if (!(error instanceof EgressDeniedError)) throw error;
      return {
        schemaVersion: "1.0",
        mode: "denied",
        allowedCollections: [],
        omittedCollections: lineage.sources.map(({ collection }) => ({
          collection,
          reason: decision.reason,
        })),
        disclosure: null,
        lineage,
        decision,
        remediation: remediationFor(decision),
      };
    }
  }

  explain(input: CollectionEgressCheckInput): CollectionEgressCheckResult {
    return this.check(input);
  }
}
