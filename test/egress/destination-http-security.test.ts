import { describe, expect, test } from "bun:test";

import {
  HttpMcpSecurity,
  resolveHttpGatewayConfig,
} from "../../src/mcp/http-security";

describe("HTTP MCP peer destination integration", () => {
  test("uses one socket peer classification and ignores forwarded headers", async () => {
    let samples = 0;
    const security = new HttpMcpSecurity(resolveHttpGatewayConfig(undefined));
    await security.initialize();
    const request = new Request("http://127.0.0.1:3000/mcp", {
      headers: {
        host: "127.0.0.1:3000",
        forwarded: "for=203.0.113.9",
        "x-forwarded-for": "203.0.113.9",
      },
    });
    const result = await security.authorize(request, {
      requestIP: () => {
        samples += 1;
        return { address: "127.0.0.2", port: 50_000 };
      },
      timeout: () => undefined,
    });
    expect(samples).toBe(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.peerClassification.zone).toBe("loopback");
      expect(result.value.request.headers.has("forwarded")).toBe(false);
      expect(result.value.request.headers.has("x-forwarded-for")).toBe(false);
    }
  });

  test("derives exact defaults for every accepted loopback bind literal", () => {
    expect(resolveHttpGatewayConfig({ host: "127.0.0.2" })).toMatchObject({
      allowedHosts: ["127.0.0.2:3000"],
      allowedOrigins: ["http://127.0.0.2:3000"],
    });
    expect(resolveHttpGatewayConfig({ host: "0:0:0:0:0:0:0:1" })).toMatchObject(
      {
        allowedHosts: ["[::1]:3000"],
        allowedOrigins: ["http://[::1]:3000"],
      }
    );
  });
});
