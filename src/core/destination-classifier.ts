/** Conservative, redacted classification for network and bind destinations. */

// node:net provides the platform IP parser; Bun has no equivalent address parser.
import { isIP } from "node:net";

import type { EgressDestinationZone } from "./egress-policy";

export const DESTINATION_ADDRESS_CLASSES = [
  "loopback",
  "private",
  "tailscale",
  "public",
  "unknown",
] as const;
export type DestinationAddressClass =
  (typeof DESTINATION_ADDRESS_CLASSES)[number];

export const DESTINATION_CLASSIFICATION_REASONS = [
  "LOCAL_PROCESS",
  "LOOPBACK_ADDRESS",
  "PRIVATE_ADDRESS",
  "TAILSCALE_ADDRESS",
  "PUBLIC_ADDRESS",
  "UNPROVEN_REMOTE",
  "MIXED_DNS_ANSWERS",
  "REMOTE_PROVIDER",
  "WILDCARD_BIND",
] as const;
export type DestinationClassificationReason =
  (typeof DESTINATION_CLASSIFICATION_REASONS)[number];

export interface DestinationClassificationAudit {
  source: "local_process" | "bind" | "literal" | "dns" | "provider";
  hostnameKind: "none" | "ip_literal" | "dns_name";
  addressCount: number;
  addressClasses: readonly DestinationAddressClass[];
  mixed: boolean;
}

export interface DestinationClassification {
  zone: EgressDestinationZone;
  addressClass: DestinationAddressClass;
  reason: DestinationClassificationReason;
  audit: DestinationClassificationAudit;
}

export interface DestinationClassifierInput {
  kind?: "network" | "bind" | "local_process";
  hostname?: string;
  addresses?: readonly string[];
  remoteProvider?: boolean;
}

const ADDRESS_CLASS_ORDER = new Map<DestinationAddressClass, number>(
  DESTINATION_ADDRESS_CLASSES.map((value, index) => [value, index])
);

function stripAddressDecoration(address: string): string {
  const unwrapped =
    address.startsWith("[") && address.endsWith("]")
      ? address.slice(1, -1)
      : address;
  return unwrapped.split("%", 1)[0]?.toLowerCase() ?? "";
}

function parseIpv4(address: string): readonly number[] | null {
  const octets = address.split(".");
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) => !/^(?:0|[1-9]\d{0,2})$/u.test(octet) || Number(octet) > 255
    )
  ) {
    return null;
  }
  return octets.map(Number);
}

function parseIpv6(address: string): readonly number[] | null {
  let normalized = stripAddressDecoration(address);
  if (isIP(normalized) !== 6) return null;

  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const ipv4 = parseIpv4(normalized.slice(separator + 1));
    if (!ipv4) return null;
    const high = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0);
    const low = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0);
    normalized = `${normalized.slice(0, separator)}:${high.toString(
      16
    )}:${low.toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null;
  }
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[\da-f]{1,4}$/u.test(group))
  ) {
    return null;
  }
  return groups.map((group) => Number.parseInt(group, 16));
}

function classifyIpv4(octets: readonly number[]): DestinationAddressClass {
  const [first = -1, second = -1] = octets;
  if (first === 127) return "loopback";
  if (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  ) {
    return "private";
  }
  if (
    first === 0 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    first >= 224 ||
    octets.every((octet) => octet === 255)
  ) {
    return "unknown";
  }
  return "public";
}

function classifyIpv6(groups: readonly number[]): DestinationAddressClass {
  const [first = -1, second = -1, third = -1] = groups;
  const isLoopback =
    groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  if (isLoopback) return "loopback";
  const isUnspecified = groups.every((group) => group === 0);
  if (isUnspecified || (first & 0xff00) === 0xff00) return "unknown";
  const isMappedIpv4 =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isMappedIpv4) {
    return classifyIpv4([
      (groups[6] ?? 0) >> 8,
      (groups[6] ?? 0) & 0xff,
      (groups[7] ?? 0) >> 8,
      (groups[7] ?? 0) & 0xff,
    ]);
  }
  if (first === 0xfd7a && second === 0x115c && third === 0xa1e0) {
    return "tailscale";
  }
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) {
    return "private";
  }
  return "public";
}

export function classifyNetworkAddress(
  address: string
): DestinationAddressClass {
  const normalized = stripAddressDecoration(address);
  const family = isIP(normalized);
  if (family === 4) {
    const octets = parseIpv4(normalized);
    return octets ? classifyIpv4(octets) : "unknown";
  }
  if (family === 6) {
    const groups = parseIpv6(normalized);
    return groups ? classifyIpv6(groups) : "unknown";
  }
  return "unknown";
}

export function isNetworkAddress(address: string): boolean {
  return isIP(stripAddressDecoration(address)) !== 0;
}

function auditFor(
  source: DestinationClassificationAudit["source"],
  hostnameKind: DestinationClassificationAudit["hostnameKind"],
  addressClasses: readonly DestinationAddressClass[],
  addressCount: number
): DestinationClassificationAudit {
  const uniqueClasses = [...new Set(addressClasses)].sort(
    (left, right) =>
      (ADDRESS_CLASS_ORDER.get(left) ?? 0) -
      (ADDRESS_CLASS_ORDER.get(right) ?? 0)
  );
  return {
    source,
    hostnameKind,
    addressCount,
    addressClasses: uniqueClasses,
    mixed: uniqueClasses.length > 1,
  };
}

function classification(
  zone: EgressDestinationZone,
  addressClass: DestinationAddressClass,
  reason: DestinationClassificationReason,
  audit: DestinationClassificationAudit
): DestinationClassification {
  return { zone, addressClass, reason, audit };
}

function classifyAddressSet(
  classes: readonly DestinationAddressClass[],
  audit: DestinationClassificationAudit
): DestinationClassification {
  if (classes.length === 0 || classes.includes("unknown")) {
    return classification("remote", "unknown", "UNPROVEN_REMOTE", audit);
  }
  if (classes.every((value) => value === "loopback")) {
    return classification("loopback", "loopback", "LOOPBACK_ADDRESS", audit);
  }
  if (
    classes.every((value) => value === "private") ||
    classes.every((value) => value === "tailscale")
  ) {
    const addressClass = classes[0] ?? "private";
    return classification(
      "lan",
      addressClass,
      addressClass === "tailscale" ? "TAILSCALE_ADDRESS" : "PRIVATE_ADDRESS",
      audit
    );
  }
  if (classes.every((value) => value === "public")) {
    return classification("remote", "public", "PUBLIC_ADDRESS", audit);
  }
  return classification("remote", "unknown", "MIXED_DNS_ANSWERS", audit);
}

/**
 * Classify only explicit addresses or supplied DNS answers. Names alone never
 * prove loopback/LAN membership, and provider identity never relaxes a zone.
 */
export function classifyDestination(
  input: DestinationClassifierInput
): DestinationClassification {
  if (input.kind === "local_process") {
    return classification(
      "local_process",
      "loopback",
      "LOCAL_PROCESS",
      auditFor("local_process", "none", [], 0)
    );
  }

  const hostname = stripAddressDecoration(input.hostname ?? "");
  const hostnameIsIp = isIP(hostname) !== 0;
  const hostnameKind = hostnameIsIp
    ? "ip_literal"
    : hostname
      ? "dns_name"
      : "none";
  const source =
    input.kind === "bind"
      ? "bind"
      : input.remoteProvider
        ? "provider"
        : hostnameIsIp
          ? "literal"
          : "dns";
  const addresses = hostnameIsIp
    ? [hostname]
    : input.addresses && input.addresses.length > 0
      ? input.addresses
      : [];
  const classes = addresses.map(classifyNetworkAddress);
  const audit = auditFor(source, hostnameKind, classes, addresses.length);

  if (input.kind === "bind" && (hostname === "0.0.0.0" || hostname === "::")) {
    return classification("remote", "unknown", "WILDCARD_BIND", audit);
  }
  if (input.remoteProvider) {
    return classification("remote", "public", "REMOTE_PROVIDER", audit);
  }
  return classifyAddressSet(classes, audit);
}

export function classifyBindDestination(
  host: string
): DestinationClassification {
  return classifyDestination({ kind: "bind", hostname: host });
}
