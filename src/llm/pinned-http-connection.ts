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

function normalizedRequestError(
  signal?: AbortSignal | null
): PinnedHttpRequestError {
  return new PinnedHttpRequestError(signal?.aborted === true);
}

function releaseReaderLock(
  reader: ReadableStreamDefaultReader<Uint8Array>
): void {
  try {
    reader.releaseLock();
  } catch {
    // The sanitized stream is already terminal; never replace its safe error.
  }
}

function sanitizeResponseBody(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal | null
): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          releaseReaderLock(reader);
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch {
        releaseReaderLock(reader);
        controller.error(normalizedRequestError(signal));
      }
    },
    async cancel(reason): Promise<void> {
      try {
        await reader.cancel(reason);
        releaseReaderLock(reader);
      } catch {
        releaseReaderLock(reader);
        throw normalizedRequestError(signal);
      }
    },
  });
}

function buildPinnedRequestInit(
  init: BunFetchRequestInit,
  headers: Headers,
  tls: BunFetchRequestInitTLS
): BunFetchRequestInit {
  return {
    body: init.body,
    cache: init.cache,
    credentials: init.credentials,
    decompress: init.decompress,
    headers,
    integrity: init.integrity,
    keepalive: init.keepalive,
    method: init.method,
    mode: init.mode,
    priority: init.priority,
    redirect: "manual",
    referrer: init.referrer,
    referrerPolicy: init.referrerPolicy,
    signal: init.signal,
    tls,
    verbose: false,
    window: init.window,
  };
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
      const response = await fetchFn(
        this.#targetUrl,
        buildPinnedRequestInit(init, headers, tls)
      );
      return new Response(sanitizeResponseBody(response.body, init.signal), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      throw normalizedRequestError(init.signal);
    }
  }
}
