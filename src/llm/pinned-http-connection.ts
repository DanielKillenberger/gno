/** Opaque request seam for one DNS-pinned HTTP connection. */

import type { DestinationClassificationAudit } from "../core/destination-classifier";

export interface HttpDestinationPolicyAudit {
  protocol: "http" | "https" | "unknown";
  port: number | null;
  redirectCount: number;
  classification: DestinationClassificationAudit;
}

export type PinnedHttpFetch = (
  input: string | URL | Request,
  init?: BunFetchRequestInit
) => Promise<Response>;

/**
 * JSON/log projection is redacted. request() is the only raw target consumer;
 * it preserves Host/SNI while forcing an IP URL and manual redirects.
 */
export class PinnedHttpConnection {
  readonly #targetUrl: string;
  readonly #hostHeader: string;
  readonly #tlsServerName?: string;
  readonly #audit: HttpDestinationPolicyAudit;

  constructor(
    targetUrl: string,
    hostHeader: string,
    tlsServerName: string | undefined,
    audit: HttpDestinationPolicyAudit
  ) {
    this.#targetUrl = targetUrl;
    this.#hostHeader = hostHeader;
    this.#tlsServerName = tlsServerName;
    this.#audit = audit;
  }

  toJSON(): { audit: HttpDestinationPolicyAudit; pinned: true } {
    return { audit: this.#audit, pinned: true };
  }

  request(
    init: BunFetchRequestInit = {},
    fetchFn: PinnedHttpFetch = fetch
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("host", this.#hostHeader);
    const tls = this.#tlsServerName
      ? { ...init.tls, serverName: this.#tlsServerName }
      : init.tls;
    return fetchFn(this.#targetUrl, {
      ...init,
      headers,
      redirect: "manual",
      tls,
      proxy: undefined,
    });
  }
}
