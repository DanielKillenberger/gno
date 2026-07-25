/** Fail-closed guard for sync modes that can spawn network-capable commands. */

import type { ToolContext } from "./context";

import { enforceCollectionEgress } from "../core/egress-enforcement";

export const enforceSyncCommandEgress = (
  ctx: ToolContext,
  input: {
    collectionNames?: readonly string[];
    gitPull?: boolean;
    runUpdateCmd?: boolean;
  }
): void => {
  if (!(input.gitPull || input.runUpdateCmd)) return;
  enforceCollectionEgress({
    collections: ctx.collections,
    collectionNames: input.collectionNames,
    action: "export",
    destinationZone: "remote",
    caller: { authenticated: true, operationAuthorized: ctx.enableWrite },
    contentClass: "source",
  });
};
