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
  readonly source: "local_process" | "bind" | "literal" | "dns" | "provider";
  readonly hostnameKind: "none" | "ip_literal" | "dns_name";
  readonly addressCount: number;
  readonly addressClasses: readonly DestinationAddressClass[];
  readonly mixed: boolean;
}

export interface DestinationClassification {
  readonly zone: EgressDestinationZone;
  readonly addressClass: DestinationAddressClass;
  readonly reason: DestinationClassificationReason;
  readonly audit: DestinationClassificationAudit;
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

interface Ipv4SpecialPrefix {
  readonly address: readonly [number, number, number, number];
  readonly prefixLength: number;
  readonly addressClass: Exclude<DestinationAddressClass, "public">;
}

// IANA IPv4 Special-Purpose Address Space, refreshed 2025-10-09. GNO
// conservatively keeps every registered block out of provider-public proof.
const IPV4_SPECIAL_PREFIXES = [
  { address: [0, 0, 0, 0], prefixLength: 8, addressClass: "unknown" },
  { address: [10, 0, 0, 0], prefixLength: 8, addressClass: "private" },
  { address: [100, 64, 0, 0], prefixLength: 10, addressClass: "unknown" },
  { address: [127, 0, 0, 0], prefixLength: 8, addressClass: "loopback" },
  { address: [169, 254, 0, 0], prefixLength: 16, addressClass: "unknown" },
  { address: [172, 16, 0, 0], prefixLength: 12, addressClass: "private" },
  { address: [192, 0, 0, 0], prefixLength: 24, addressClass: "unknown" },
  { address: [192, 0, 2, 0], prefixLength: 24, addressClass: "unknown" },
  { address: [192, 31, 196, 0], prefixLength: 24, addressClass: "unknown" },
  { address: [192, 52, 193, 0], prefixLength: 24, addressClass: "unknown" },
  { address: [192, 88, 99, 0], prefixLength: 24, addressClass: "unknown" },
  { address: [192, 168, 0, 0], prefixLength: 16, addressClass: "private" },
  { address: [192, 175, 48, 0], prefixLength: 24, addressClass: "unknown" },
  { address: [198, 18, 0, 0], prefixLength: 15, addressClass: "unknown" },
  { address: [198, 51, 100, 0], prefixLength: 24, addressClass: "unknown" },
  { address: [203, 0, 113, 0], prefixLength: 24, addressClass: "unknown" },
  { address: [224, 0, 0, 0], prefixLength: 3, addressClass: "unknown" },
] as const satisfies readonly Ipv4SpecialPrefix[];

function ipv4Integer(octets: readonly number[]): number {
  return (
    ((((octets[0] ?? 0) << 24) >>> 0) |
      ((octets[1] ?? 0) << 16) |
      ((octets[2] ?? 0) << 8) |
      (octets[3] ?? 0)) >>>
    0
  );
}

function matchesIpv4Prefix(
  octets: readonly number[],
  prefix: Ipv4SpecialPrefix
): boolean {
  const mask =
    prefix.prefixLength === 0
      ? 0
      : (0xffffffff << (32 - prefix.prefixLength)) >>> 0;
  return (
    (ipv4Integer(octets) & mask) >>> 0 ===
    (ipv4Integer(prefix.address) & mask) >>> 0
  );
}

function classifyIpv4(octets: readonly number[]): DestinationAddressClass {
  for (const prefix of IPV4_SPECIAL_PREFIXES) {
    if (matchesIpv4Prefix(octets, prefix)) return prefix.addressClass;
  }
  return "public";
}

interface Ipv6Prefix {
  readonly groups: readonly number[];
  readonly prefixLength: number;
}

// IANA IPv6 Special-Purpose Address Space, refreshed 2025-10-09. Mapped IPv4
// and the globally reachable NAT64 WKP are handled separately by target
// semantics; every prefix below remains ineligible for provider-public proof.
const IPV6_SPECIAL_PREFIXES = [
  { groups: [0x0100], prefixLength: 64 },
  { groups: [0x0100, 0, 0, 1], prefixLength: 64 },
  { groups: [0x2001], prefixLength: 23 },
  { groups: [0x2001, 0x0db8], prefixLength: 32 },
  { groups: [0x2002], prefixLength: 16 },
  { groups: [0x2620, 0x004f, 0x8000], prefixLength: 48 },
  { groups: [0x3fff], prefixLength: 20 },
  { groups: [0x5f00], prefixLength: 16 },
] as const satisfies readonly Ipv6Prefix[];

function matchesIpv6Prefix(
  groups: readonly number[],
  prefix: Ipv6Prefix
): boolean {
  const fullGroups = Math.floor(prefix.prefixLength / 16);
  for (let index = 0; index < fullGroups; index += 1) {
    if ((groups[index] ?? 0) !== (prefix.groups[index] ?? 0)) return false;
  }
  const remainingBits = prefix.prefixLength % 16;
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (
    ((groups[fullGroups] ?? 0) & mask) ===
    ((prefix.groups[fullGroups] ?? 0) & mask)
  );
}

function embeddedIpv4Class(
  groups: readonly number[],
  highGroupIndex: number
): DestinationAddressClass {
  const high = groups[highGroupIndex] ?? 0;
  const low = groups[highGroupIndex + 1] ?? 0;
  return classifyIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
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
    return embeddedIpv4Class(groups, 6);
  }
  const isCompatibleIpv4 = groups.slice(0, 6).every((group) => group === 0);
  if (isCompatibleIpv4) return "unknown";
  const isPublicNat64 =
    first === 0x0064 &&
    second === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0);
  if (isPublicNat64) {
    return embeddedIpv4Class(groups, 6) === "public" ? "public" : "unknown";
  }
  const isLocalNat64 =
    first === 0x0064 && second === 0xff9b && third === 0x0001;
  if (isLocalNat64 || first === 0x2002) return "unknown";
  if (first === 0xfd7a && second === 0x115c && third === 0xa1e0) {
    return "tailscale";
  }
  const isAwsInstanceMetadata =
    first === 0xfd00 &&
    second === 0x0ec2 &&
    groups.slice(2, 7).every((group) => group === 0) &&
    groups[7] === 0x0254;
  if (isAwsInstanceMetadata) return "unknown";
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) {
    return "private";
  }
  if (
    IPV6_SPECIAL_PREFIXES.some((prefix) => matchesIpv6Prefix(groups, prefix))
  ) {
    return "unknown";
  }
  return matchesIpv6Prefix(groups, {
    groups: [0x2000],
    prefixLength: 3,
  })
    ? "public"
    : "unknown";
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
  const addressSet = classifyAddressSet(classes, audit);
  if (input.remoteProvider && addressSet.addressClass === "public") {
    return classification("remote", "public", "REMOTE_PROVIDER", audit);
  }
  return addressSet;
}

export function classifyBindDestination(
  host: string
): DestinationClassification {
  return classifyDestination({ kind: "bind", hostname: host });
}
