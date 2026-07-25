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

export class PinnedHttpRequestError extends Error {
  readonly code = "PINNED_HTTP_REQUEST_FAILED";
  readonly aborted: boolean;

  constructor(aborted: boolean) {
    super(
      aborted ? "Pinned HTTP request aborted" : "Pinned HTTP request failed"
    );
    this.name = "PinnedHttpRequestError";
    this.aborted = aborted;
    this.stack = `${this.name}: ${this.message}`;
  }

  toJSON(): { code: string; message: string; aborted: boolean } {
    return { code: this.code, message: this.message, aborted: this.aborted };
  }
}

function freezeAudit(
  audit: HttpDestinationPolicyAudit
): HttpDestinationPolicyAudit {
  const classification = Object.freeze({
    ...audit.classification,
    addressClasses: Object.freeze([...audit.classification.addressClasses]),
  });
  return Object.freeze({ ...audit, classification });
}

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
    this.#audit = freezeAudit(audit);
  }

  toJSON(): { audit: HttpDestinationPolicyAudit; pinned: true } {
    return { audit: this.#audit, pinned: true };
  }

  async request(
    init: BunFetchRequestInit = {},
    fetchFn: PinnedHttpFetch = fetch
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("host", this.#hostHeader);
    const {
      checkServerIdentity: _ignoredIdentityOverride,
      rejectUnauthorized: _ignoredVerificationOverride,
      serverName: _ignoredServerNameOverride,
      ...callerTls
    } = init.tls ?? {};
    const tls = {
      ...callerTls,
      rejectUnauthorized: true,
      serverName: this.#tlsServerName,
    };
    try {
      const response = await fetchFn(this.#targetUrl, {
        ...init,
        headers,
        redirect: "manual",
        tls,
        proxy: undefined,
      });
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      throw new PinnedHttpRequestError(init.signal?.aborted === true);
    }
  }
}
