import { describe, expect, test } from "bun:test";

import type { RequestPeerServer } from "../../src/serve/request-locality";

import {
  isLocalClientRequest,
  isLoopbackHostHeader,
} from "../../src/serve/request-locality";

function peer(address: string | null): RequestPeerServer {
  return {
    requestIP: () => (address === null ? null : { address, port: 49_152 }),
  };
}

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/capabilities", { headers });
}

describe("isLocalClientRequest", () => {
  const matrix: Array<{
    name: string;
    peer: string | null;
    headers: Record<string, string>;
    expected: boolean;
  }> = [
    {
      name: "loopback peer + localhost Host",
      peer: "127.0.0.1",
      headers: { host: "localhost:3000" },
      expected: true,
    },
    {
      name: "loopback peer + 127.x Host without port",
      peer: "127.0.0.1",
      headers: { host: "127.0.0.1" },
      expected: true,
    },
    {
      name: "IPv6 loopback peer + bracket Host",
      peer: "::1",
      headers: { host: "[::1]:3000" },
      expected: true,
    },
    {
      name: "IPv4-mapped loopback peer",
      peer: "::ffff:127.0.0.1",
      headers: { host: "localhost:3000" },
      expected: true,
    },
    {
      name: "loopback peer + non-loopback Host (port forwarder)",
      peer: "127.0.0.1",
      headers: { host: "remote-host.example:3000" },
      expected: false,
    },
    {
      name: "loopback peer + X-Forwarded-For (reverse proxy)",
      peer: "127.0.0.1",
      headers: { host: "localhost:3000", "x-forwarded-for": "10.0.0.7" },
      expected: false,
    },
    {
      name: "loopback peer + Forwarded",
      peer: "127.0.0.1",
      headers: { host: "localhost:3000", forwarded: "for=10.0.0.7" },
      expected: false,
    },
    {
      name: "loopback peer + X-Forwarded-Host",
      peer: "127.0.0.1",
      headers: { host: "localhost:3000", "x-forwarded-host": "remote" },
      expected: false,
    },
    {
      name: "loopback peer + X-Forwarded-Proto",
      peer: "127.0.0.1",
      headers: { host: "localhost:3000", "x-forwarded-proto": "https" },
      expected: false,
    },
    {
      name: "non-loopback peer (kernel redirect)",
      peer: "192.0.2.10",
      headers: { host: "localhost:3000" },
      expected: false,
    },
    {
      name: "unknown peer",
      peer: null,
      headers: { host: "localhost:3000" },
      expected: false,
    },
  ];

  for (const row of matrix) {
    test(row.name, () => {
      expect(isLocalClientRequest(request(row.headers), peer(row.peer))).toBe(
        row.expected
      );
    });
  }

  test("missing server fails closed", () => {
    expect(
      isLocalClientRequest(request({ host: "localhost:3000" }), undefined)
    ).toBe(false);
  });
});

describe("isLoopbackHostHeader", () => {
  test.each([
    ["localhost", true],
    ["LOCALHOST:3000", true],
    ["127.0.0.1:3000", true],
    ["127.255.0.9", true],
    ["[::1]", true],
    ["[::1]:3000", true],
    ["[::ffff:127.0.0.1]:3000", true],
    ["::1", false],
    ["localhost:abc", false],
    ["localhost.example", false],
    ["128.0.0.1:3000", false],
    ["[::2]:3000", false],
    ["[::1", false],
    ["", false],
    [null, false],
  ])("%p -> %p", (host, expected) => {
    expect(isLoopbackHostHeader(host)).toBe(expected);
  });
});
