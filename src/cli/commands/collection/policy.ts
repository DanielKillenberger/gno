/** Collection egress policy management commands. */

import type { EgressPolicy } from "../../../config/types";
import type {
  EgressAction,
  EgressContentClass,
  EgressDestinationZone,
} from "../../../core/egress-policy";

import { loadConfig } from "../../../config";
import { projectCollectionEgressPolicy } from "../../../core/collection-egress-policy-projection";
import { CollectionEgressPolicyService } from "../../../core/collection-egress-policy-service";
import { applyConfigChange } from "../../../core/config-mutation";
import { CliError } from "../../errors";
import { initStore } from "../shared";

interface PolicyOptions {
  configPath?: string;
  indexName?: string;
}

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

export const collectionPolicyGet = async (
  name: string,
  options: PolicyOptions = {}
): Promise<void> => {
  const loaded = await loadConfig(options.configPath);
  if (!loaded.ok) throw new CliError("RUNTIME", loaded.error.message);
  const state = new CollectionEgressPolicyService({
    getConfig: () => loaded.value,
  }).get(name);
  if (!state.ok) throw new CliError("VALIDATION", state.error);
  writeJson(state.value);
};

export const collectionPolicySet = async (
  name: string,
  policy: EgressPolicy,
  options: PolicyOptions & { confirmRelaxation?: string } = {}
): Promise<void> => {
  const initialized = await initStore({
    configPath: options.configPath,
    indexName: options.indexName,
  });
  if (!initialized.ok) throw new CliError("RUNTIME", initialized.error);
  let config = initialized.config;
  try {
    const currentResult = new CollectionEgressPolicyService({
      getConfig: () => config,
    }).get(name);
    const service = new CollectionEgressPolicyService({
      getConfig: () => config,
      mutateConfig: async (mutate) => {
        const result = await applyConfigChange(
          {
            store: initialized.store,
            configPath: initialized.actualConfigPath,
            onConfigUpdated: (next) => {
              config = next;
            },
            projectStore: (store, next) =>
              projectCollectionEgressPolicy(store, next, name),
          },
          mutate
        );
        return result;
      },
    });
    const result = await service.set({
      collection: name,
      policy,
      confirmation:
        currentResult.ok && options.confirmRelaxation
          ? {
              collection: currentResult.value.collection,
              currentPolicy: currentResult.value.effectivePolicy,
              currentRevision: Number(options.confirmRelaxation),
              targetPolicy: policy,
              acknowledged: true,
            }
          : undefined,
    });
    if (!result.ok) {
      throw new CliError("VALIDATION", result.error, {
        details: { policyCode: result.code },
      });
    }
    writeJson(result.value);
  } finally {
    await initialized.store.close();
  }
};

export const collectionPolicyCheck = async (
  input: {
    collections?: string[];
    action: EgressAction;
    destinationZone: EgressDestinationZone;
    contentClass: EgressContentClass;
    authenticated: boolean;
    authorized: boolean;
    partial?: boolean;
  },
  options: PolicyOptions = {}
): Promise<void> => {
  const loaded = await loadConfig(options.configPath);
  if (!loaded.ok) throw new CliError("RUNTIME", loaded.error.message);
  const result = new CollectionEgressPolicyService({
    getConfig: () => loaded.value,
  }).explain({
    collections: input.collections,
    action: input.action,
    destinationZone: input.destinationZone,
    caller: {
      authenticated: input.authenticated,
      operationAuthorized: input.authorized,
    },
    contentClass: input.contentClass,
    partialResults: input.partial ? "explicit" : "deny",
  });
  if (!result.ok) throw new CliError("VALIDATION", result.error);
  writeJson(result.value);
};
