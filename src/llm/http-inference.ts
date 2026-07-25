/** Policy-gated, DNS-pinned HTTP transport shared by inference adapters. */

import type { Collection } from "../config/types";
import type { CollectionEgressState } from "../core/egress-policy";
import type { EgressDestinationZone } from "../core/egress-policy";
import type {
  HttpDestinationPolicyOptions,
  HttpDestinationResolver,
  PinnedHttpFetch,
} from "./http-policy";

import { classifyDestination } from "../core/destination-classifier";
import {
  collectionEgressStates,
  EgressDeniedError,
  maximumDestinationZoneForCollections,
} from "../core/egress-enforcement";
import { evaluateEgressPolicy } from "../core/egress-policy";
import { prepareHttpDestination } from "./http-policy";

const SYSTEM_EGRESS_STATE = {
  collection: "system",
  policy: "local_only",
  source: "config_default",
} as const satisfies CollectionEgressState;

const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);

export interface HttpInferenceOptions {
  collections?: readonly Collection[];
  collectionNames?: readonly string[];
  authenticated?: boolean;
  operationAuthorized?: boolean;
  resolver?: HttpDestinationResolver;
  fetchFn?: PinnedHttpFetch;
  env?: HttpDestinationPolicyOptions["env"];
}

const scopedStates = (
  options: HttpInferenceOptions
): readonly CollectionEgressState[] => {
  const states = collectionEgressStates(
    options.collections ?? [],
    options.collectionNames
  );
  return states.length > 0 ? states : [SYSTEM_EGRESS_STATE];
};

const enforce = (
  states: readonly CollectionEgressState[],
  zone: EgressDestinationZone,
  options: HttpInferenceOptions
): void => {
  const decision = evaluateEgressPolicy({
    collections: states,
    action: "remote_inference",
    destination: { zone },
    caller: {
      authenticated: options.authenticated ?? true,
      operationAuthorized: options.operationAuthorized ?? true,
    },
    contentClass: "source",
  });
  if (!decision.allowed) throw new EgressDeniedError(decision);
};

const initialZone = (
  url: URL,
  maximumZone: "loopback" | "lan" | "remote"
): "loopback" | "lan" | "remote" => {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "loopback";
  }
  const classification = classifyDestination({
    kind: "network",
    hostname,
  });
  if (
    classification.audit.hostnameKind === "dns_name" &&
    maximumZone !== "remote"
  ) {
    return "remote";
  }
  return classification.zone === "local_process"
    ? maximumZone
    : classification.zone;
};

const isRemoteProviderCandidate = (url: URL): boolean => {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  return (
    classifyDestination({ kind: "network", hostname }).audit.hostnameKind ===
    "dns_name"
  );
};

export const requestHttpInference = async (
  rawUrl: string,
  init: BunFetchRequestInit,
  options: HttpInferenceOptions = {}
): Promise<Response> => {
  const url = new URL(rawUrl);
  const collections = options.collections ?? [];
  const states = scopedStates(options);
  const maximumZone = maximumDestinationZoneForCollections(
    collections,
    options.collectionNames
  );

  // Policy check precedes DNS, socket creation, body transfer, and provider
  // metadata transfer. Unproven names are remote unless explicitly localhost.
  enforce(states, initialZone(url, maximumZone), options);

  let prepared = await prepareHttpDestination(url.href, {
    maximumZone,
    resolver: options.resolver,
    remoteProvider: isRemoteProviderCandidate(url),
    env: options.env,
  });
  if (!prepared.ok) {
    throw new EgressDeniedError(
      evaluateEgressPolicy({
        collections: states,
        action: "remote_inference",
        destination: { zone: prepared.classification.zone },
        caller: {
          authenticated: options.authenticated ?? true,
          operationAuthorized: false,
        },
        contentClass: "source",
      })
    );
  }

  let currentUrl = url;
  for (;;) {
    enforce(states, prepared.value.classification.zone, options);
    const connection = await prepared.value.acquireConnection();
    if (!connection.ok) {
      throw new EgressDeniedError(
        evaluateEgressPolicy({
          collections: states,
          action: "remote_inference",
          destination: { zone: connection.classification.zone },
          caller: {
            authenticated: options.authenticated ?? true,
            operationAuthorized: false,
          },
          contentClass: "source",
        })
      );
    }
    const response = await connection.value.request(init, options.fetchFn);
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.origin.toLowerCase() !== currentUrl.origin.toLowerCase()) {
      throw new EgressDeniedError(
        evaluateEgressPolicy({
          collections: states,
          action: "remote_inference",
          destination: { zone: prepared.value.classification.zone },
          caller: {
            authenticated: options.authenticated ?? true,
            operationAuthorized: false,
          },
          contentClass: "source",
        })
      );
    }
    const next = await prepared.value.followRedirect(nextUrl.href);
    if (!next.ok) {
      throw new EgressDeniedError(
        evaluateEgressPolicy({
          collections: states,
          action: "remote_inference",
          destination: { zone: next.classification.zone },
          caller: {
            authenticated: options.authenticated ?? true,
            operationAuthorized: false,
          },
          contentClass: "source",
        })
      );
    }
    currentUrl = nextUrl;
    prepared = next;
  }
};
