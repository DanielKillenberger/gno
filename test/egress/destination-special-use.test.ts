import { describe, expect, test } from "bun:test";

import { classifyNetworkAddress } from "../../src/core/destination-classifier";
import { prepareHttpDestination } from "../../src/llm/http-policy";

function literalUrl(address: string): string {
  const host = address.includes(":") ? `[${address}]` : address;
  return `https://${host}/v1`;
}

describe("special-use destination classification", () => {
  test("denies IANA special-use and non-global ranges to remote providers", async () => {
    const addresses = [
      "0.1.2.3",
      "100.64.0.1",
      "169.254.169.254",
      "192.0.0.1",
      "192.0.2.1",
      "192.31.196.1",
      "192.52.193.1",
      "192.88.99.1",
      "192.175.48.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "239.255.255.255",
      "240.0.0.1",
      "255.255.255.255",
      "64:ff9b:1::a9fe:a9fe",
      "100::1",
      "100:0:0:1::1",
      "2001::1",
      "2001:2::1",
      "2001:db8::1",
      "2002:808:808::1",
      "2620:4f:8000::1",
      "3fff::1",
      "5f00::1",
      "4000::1",
      "fe80::1",
      "ff02::1",
      "::ffff:192.0.2.1",
      "64:ff9b::c000:201",
    ];

    for (const address of addresses) {
      expect(classifyNetworkAddress(address), address).not.toBe("public");
      expect(
        await prepareHttpDestination(literalUrl(address), {
          maximumZone: "remote",
          remoteProvider: true,
          env: {},
        }),
        address
      ).toMatchObject({
        ok: false,
        reason: "PROVIDER_ADDRESS_NOT_PUBLIC",
      });
    }

    expect(
      await prepareHttpDestination("https://provider.example/v1", {
        maximumZone: "remote",
        remoteProvider: true,
        resolver: {
          lookup: () => Promise.resolve(["8.8.8.8", "192.0.2.1"]),
        },
        env: {},
      })
    ).toMatchObject({
      ok: false,
      reason: "PROVIDER_ADDRESS_NOT_PUBLIC",
      classification: {
        addressClass: "unknown",
        reason: "UNPROVEN_REMOTE",
      },
    });
  });

  test("preserves embedded IPv4 safety semantics", () => {
    const fixtures = [
      ["::ffff:127.0.0.1", "loopback"],
      ["::ffff:10.0.0.1", "private"],
      ["::ffff:169.254.169.254", "unknown"],
      ["::ffff:8.8.8.8", "public"],
      ["::127.0.0.1", "unknown"],
      ["::8.8.8.8", "unknown"],
      ["64:ff9b::7f00:1", "unknown"],
      ["64:ff9b::a00:1", "unknown"],
      ["64:ff9b::808:808", "public"],
      ["64:ff9b:1::a00:1", "unknown"],
      ["64:ff9b:1::808:808", "unknown"],
      ["2002:7f00:1::1", "unknown"],
      ["2002:a00:1::1", "unknown"],
      ["2002:808:808::1", "unknown"],
    ] as const;

    for (const [address, expected] of fixtures) {
      expect(classifyNetworkAddress(address), address).toBe(expected);
    }
  });

  test("allows proven global-unicast public controls", async () => {
    const addresses = [
      "1.1.1.1",
      "8.8.8.8",
      "93.184.216.34",
      "2001:4860:4860::8888",
      "2606:4700:4700::1111",
      "64:ff9b::808:808",
      "::ffff:8.8.8.8",
    ];

    for (const address of addresses) {
      expect(classifyNetworkAddress(address), address).toBe("public");
      expect(
        await prepareHttpDestination(literalUrl(address), {
          maximumZone: "remote",
          remoteProvider: true,
          env: {},
        }),
        address
      ).toMatchObject({
        ok: true,
        reason: "DESTINATION_ALLOWED",
        value: {
          classification: {
            addressClass: "public",
            reason: "REMOTE_PROVIDER",
          },
        },
      });
    }
  });
});
