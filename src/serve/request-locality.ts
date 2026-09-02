/**
 * Request locality: is the caller a same-host browser?
 *
 * `gno serve` binds to loopback only, so every remote client reaches it through
 * a same-host proxy or forwarder whose socket peer is loopback. A peer-only
 * check would call those clients local; this rule also requires a loopback
 * Host header and the absence of forwarding headers, and it fails closed.
 */

import type { HttpMcpPeerServer } from "../mcp/http-security";

export type RequestPeerServer = Pick<HttpMcpPeerServer, "requestIP">;

const FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
] as const;

const IPV4_MAPPED_PREFIX = "::ffff:";
const IPV4_OCTET = /^\d{1,3}$/;
const HOST_PORT = /^:\d{1,5}$/;
const LOOPBACK_IPV4_FIRST_OCTET = 127;
const MAX_OCTET = 255;
const IPV4_OCTET_COUNT = 4;

/** Loopback socket address: 127.0.0.0/8, ::1, or an IPv4-mapped form. */
export function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  const mapped = normalized.startsWith(IPV4_MAPPED_PREFIX)
    ? normalized.slice(IPV4_MAPPED_PREFIX.length)
    : normalized;
  const octets = mapped.split(".");
  return (
    octets.length === IPV4_OCTET_COUNT &&
    octets.every((octet) => IPV4_OCTET.test(octet)) &&
    Number(octets[0]) === LOOPBACK_IPV4_FIRST_OCTET &&
    octets.every((octet) => Number(octet) <= MAX_OCTET)
  );
}

/** Host part of a Host header (`name`, `name:port`, `[v6]`, `[v6]:port`). */
function hostHeaderName(host: string): string | null {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) return null;
    const rest = trimmed.slice(end + 1);
    if (rest !== "" && !HOST_PORT.test(rest)) return null;
    return trimmed.slice(1, end) || null;
  }
  const [name, ...portParts] = trimmed.split(":");
  if (portParts.length > 1) return null;
  if (portParts.length === 1 && !HOST_PORT.test(`:${portParts[0]}`)) {
    return null;
  }
  return name || null;
}

/** Host header naming a loopback host: `localhost`, `127.x.x.x`, or `[::1]`. */
export function isLoopbackHostHeader(host: string | null): boolean {
  if (!host) return false;
  const name = hostHeaderName(host);
  if (!name) return false;
  return name === "localhost" || isLoopbackAddress(name);
}

/**
 * True only when the socket peer is loopback, the Host header names a loopback
 * host, and no forwarding header is present. Any other combination, a missing
 * server, or an unknown peer yields false.
 */
export function isLocalClientRequest(
  request: Request,
  server: RequestPeerServer | undefined
): boolean {
  const peer = server?.requestIP(request) ?? null;
  if (!peer || !isLoopbackAddress(peer.address)) return false;
  if (!isLoopbackHostHeader(request.headers.get("host"))) return false;
  return !FORWARDING_HEADERS.some((header) => request.headers.has(header));
}
