/** Shared client view of GET /api/capabilities. */

import { apiFetch } from "../hooks/use-api";

export interface ServerCapabilities {
  bm25: boolean;
  vector: boolean;
  hybrid: boolean;
  answer: boolean;
  /** True only for a same-host client; a proxied or forwarded request is remote. */
  localClient: boolean;
}

export function fetchServerCapabilities(): Promise<{
  data: ServerCapabilities | null;
  error: string | null;
}> {
  return apiFetch<ServerCapabilities>("/api/capabilities");
}
