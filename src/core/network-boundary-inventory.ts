/** Checked inventory of current network-capable and process boundaries. */

import type { EgressAction } from "./egress-policy";

export type NetworkBoundaryMarker =
  | "bun_serve"
  | "external_process"
  | "fetch"
  | "http_inference"
  | "mcp_method"
  | "mcp_tool"
  | "structural_exception";

export interface NetworkBoundaryInventoryEntry {
  id: string;
  path: string;
  marker: NetworkBoundaryMarker;
  action: EgressAction | null;
  enforcement:
    | "collection_policy"
    | "loopback_only"
    | "local_process_only"
    | "no_collection_data"
    | "disabled";
}

export const NETWORK_BOUNDARY_INVENTORY = [
  {
    id: "daemon-listener",
    path: "src/cli/commands/daemon.ts",
    marker: "bun_serve",
    action: "serve",
    enforcement: "collection_policy",
  },
  {
    id: "serve-listener",
    path: "src/serve/server.ts",
    marker: "bun_serve",
    action: "serve",
    enforcement: "loopback_only",
  },
  {
    id: "serve-route-types",
    path: "src/serve/routes/api.ts",
    marker: "bun_serve",
    action: null,
    enforcement: "no_collection_data",
  },
  {
    id: "browser-api-client",
    path: "src/serve/public/hooks/use-api.ts",
    marker: "fetch",
    action: "serve",
    enforcement: "loopback_only",
  },
  {
    id: "detached-runtime-health",
    path: "src/cli/detach.ts",
    marker: "fetch",
    action: null,
    enforcement: "no_collection_data",
  },
  {
    id: "detached-runtime-process",
    path: "src/cli/detach.ts",
    marker: "external_process",
    action: null,
    enforcement: "no_collection_data",
  },
  {
    id: "semantic-setup-process",
    path: "src/cli/commands/setup-semantic.ts",
    marker: "external_process",
    action: null,
    enforcement: "no_collection_data",
  },
  {
    id: "terminal-pager",
    path: "src/cli/pager.ts",
    marker: "external_process",
    action: null,
    enforcement: "local_process_only",
  },
  {
    id: "file-lock-process-probe",
    path: "src/core/file-lock.ts",
    marker: "external_process",
    action: null,
    enforcement: "no_collection_data",
  },
  {
    id: "local-file-operations",
    path: "src/core/file-ops.ts",
    marker: "external_process",
    action: null,
    enforcement: "local_process_only",
  },
  {
    id: "sync-update-and-git",
    path: "src/ingestion/sync.ts",
    marker: "external_process",
    action: "export",
    enforcement: "collection_policy",
  },
  {
    id: "http-embedding",
    path: "src/llm/httpEmbedding.ts",
    marker: "http_inference",
    action: "remote_inference",
    enforcement: "collection_policy",
  },
  {
    id: "http-generation",
    path: "src/llm/httpGeneration.ts",
    marker: "http_inference",
    action: "remote_inference",
    enforcement: "collection_policy",
  },
  {
    id: "http-rerank",
    path: "src/llm/httpRerank.ts",
    marker: "http_inference",
    action: "remote_inference",
    enforcement: "collection_policy",
  },
  {
    id: "http-mcp-tools",
    path: "src/mcp/http-egress.ts",
    marker: "mcp_tool",
    action: "serve",
    enforcement: "collection_policy",
  },
  {
    id: "http-mcp-resources",
    path: "src/mcp/http-egress.ts",
    marker: "mcp_method",
    action: "serve",
    enforcement: "collection_policy",
  },
  {
    id: "local-publish-artifact",
    path: "src/publish/export-service.ts",
    marker: "structural_exception",
    action: "export",
    enforcement: "local_process_only",
  },
  {
    id: "remote-publish-upload",
    path: "src/publish/export-service.ts",
    marker: "structural_exception",
    action: null,
    enforcement: "disabled",
  },
  {
    id: "private-agent-access",
    path: "src/publish/encrypted-export.ts",
    marker: "structural_exception",
    action: null,
    enforcement: "disabled",
  },
] as const satisfies readonly NetworkBoundaryInventoryEntry[];
