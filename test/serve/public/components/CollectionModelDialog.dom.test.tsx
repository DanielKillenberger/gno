import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { apiOk, renderWithUser } from "../../../helpers/dom";

const apiFetch = mock(async (..._args: unknown[]) => apiOk<unknown>({}));

void mock.module("../../../../src/serve/public/hooks/use-api", () => ({
  apiFetch,
}));

describe("CollectionModelDialog DOM interactions", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    globalThis.NodeFilter ??= window.NodeFilter;
    globalThis.HTMLInputElement ??= window.HTMLInputElement;
  });

  test("renders effective model state and saves a role override patch", async () => {
    apiFetch.mockImplementation(async (...args: unknown[]) => {
      const endpoint = typeof args[0] === "string" ? args[0] : "";
      if (endpoint === "/api/collections/docs") {
        return apiOk({
          success: true,
          collection: {},
        });
      }
      if (endpoint === "/api/egress/audits/status") {
        return apiOk({
          bytes: 0,
          receipts: 0,
          retention: { maxAgeDays: 30, maxBytes: 1024, maxReceipts: 1000 },
        });
      }
      if (endpoint.startsWith("/api/egress/audits?")) {
        return apiOk({ nextCursor: null, receipts: [] });
      }
      return apiOk({});
    });

    const { CollectionModelDialog } =
      await import("../../../../src/serve/public/components/CollectionModelDialog");
    const onOpenChange = mock(() => undefined);
    const onSaved = mock(() => undefined);
    const { user } = renderWithUser(
      <CollectionModelDialog
        collection={{
          activePresetId: "slim-tuned",
          chunkCount: 42,
          documentCount: 12,
          effectiveModels: {
            embed: "hf:baseline/embed.gguf",
            rerank: "hf:baseline/rerank.gguf",
            expand: "hf:baseline/expand.gguf",
            gen: "hf:baseline/gen.gguf",
          },
          modelSources: {
            embed: "preset",
            rerank: "override",
            expand: "preset",
            gen: "preset",
          },
          include: [".ts", ".tsx"],
          models: {
            rerank: "hf:custom/rerank.gguf",
          },
          name: "docs",
          path: "/tmp/docs",
          pattern: "**/*.{ts,tsx}",
        }}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        open={true}
      />
    );

    expect(await screen.findByRole("heading", { name: "docs" })).toBeTruthy();
    expect(screen.getByText("preset: slim-tuned")).toBeTruthy();
    expect(screen.getByText("hf:baseline/embed.gguf")).toBeTruthy();
    expect(screen.getAllByText("inherits").length).toBeGreaterThan(0);
    expect(screen.getByText("override")).toBeTruthy();
    expect(screen.getByText("Apply code-optimized embedding")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /apply code-optimized embedding/i })
    ).toBeTruthy();

    const inputs = screen.getAllByPlaceholderText(
      "Leave empty to inherit from preset"
    );
    const embedInput = inputs[0];
    expect(embedInput).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: /apply code-optimized embedding/i })
    );

    expect(screen.getByText("Re-index needed after save")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: /save collection settings/i })
    );

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    const patchCall = apiFetch.mock.calls.find(
      ([endpoint]) => endpoint === "/api/collections/docs"
    );
    const requestOptions = patchCall?.[1] as RequestInit | undefined;
    const rawBody = requestOptions?.body;
    const bodyText =
      typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody ?? {});
    const requestBody = JSON.parse(bodyText) as {
      models?: { embed?: string };
    };
    expect(patchCall?.[0]).toBe("/api/collections/docs");
    expect(requestOptions?.method).toBe("PATCH");
    expect(requestBody.models?.embed).toContain("Qwen3-Embedding-0.6B-GGUF");
  });

  test("requires visible revision-bound confirmation before relaxing policy", async () => {
    apiFetch.mockImplementation(async (...args: unknown[]) => {
      const endpoint = typeof args[0] === "string" ? args[0] : "";
      if (endpoint === "/api/egress/audits/status") {
        return apiOk({
          bytes: 0,
          receipts: 0,
          retention: { maxAgeDays: 30, maxBytes: 1024, maxReceipts: 1000 },
        });
      }
      if (endpoint.startsWith("/api/egress/audits?")) {
        return apiOk({ nextCursor: null, receipts: [] });
      }
      return apiOk({});
    });
    const { CollectionModelDialog } =
      await import("../../../../src/serve/public/components/CollectionModelDialog");
    const { user } = renderWithUser(
      <CollectionModelDialog
        collection={{
          chunkCount: 0,
          documentCount: 0,
          name: "private-notes",
          path: "/tmp/private",
          egressPolicy: {
            schemaVersion: "1.0",
            collection: "private-notes",
            configuredPolicy: null,
            effectivePolicy: "local_only",
            revision: 7,
            source: "config_default",
            version: `egress-policy-v1:${"a".repeat(64)}`,
          },
        }}
        onOpenChange={() => undefined}
        onSaved={() => undefined}
        open={true}
      />
    );
    await user.selectOptions(
      screen.getByLabelText("Collection policy"),
      "remote"
    );
    const save = screen.getByRole("button", {
      name: /save collection settings/i,
    });
    expect((save as HTMLButtonElement).disabled).toBeTrue();
    await user.click(
      screen.getByRole("checkbox", {
        name: /I confirm this expands where collection content may travel/i,
      })
    );
    expect((save as HTMLButtonElement).disabled).toBeFalse();
    await user.click(save);
    await waitFor(() =>
      expect(
        apiFetch.mock.calls.some(
          ([endpoint]) =>
            endpoint === "/api/collections/private-notes/egress-policy"
        )
      ).toBeTrue()
    );
    const policyCall = apiFetch.mock.calls.find(
      ([endpoint]) =>
        endpoint === "/api/collections/private-notes/egress-policy"
    );
    const request = policyCall?.[1] as RequestInit;
    const body = request.body;
    expect(JSON.parse(typeof body === "string" ? body : "{}")).toMatchObject({
      policy: "remote",
      confirmation: {
        collection: "private-notes",
        currentPolicy: "local_only",
        currentRevision: 7,
        targetPolicy: "remote",
        acknowledged: true,
      },
    });
  });

  test("explains policy decisions and manages local audit receipts with explicit confirmations", async () => {
    apiFetch.mockImplementation(async (...args: unknown[]) => {
      const endpoint = typeof args[0] === "string" ? args[0] : "";
      const init = args[1] as RequestInit | undefined;
      if (endpoint === "/api/egress/check") {
        const rawBody = init?.body;
        const request = JSON.parse(
          typeof rawBody === "string" ? rawBody : "{}"
        ) as {
          partialResults?: string;
        };
        if (request.partialResults === "explicit") {
          return apiOk({
            allowedCollections: ["public"],
            mode: "partial",
            decision: { allowed: false, reason: "POLICY_LOCAL_ONLY" },
            disclosure: {
              code: "EGRESS_PARTIAL_RESULT",
              omittedCount: 1,
              omittedCollections: ["private-notes"],
            },
            omittedCollections: [
              { collection: "private-notes", reason: "POLICY_LOCAL_ONLY" },
            ],
            remediation: { message: "Keep the action local." },
          });
        }
        return apiOk({
          allowedCollections: [],
          mode: "denied",
          decision: { allowed: false, reason: "POLICY_LOCAL_ONLY" },
          disclosure: null,
          omittedCollections: [
            { collection: "private-notes", reason: "POLICY_LOCAL_ONLY" },
          ],
          remediation: { message: "Keep the action local." },
        });
      }
      if (endpoint === "/api/egress/audits/status") {
        return apiOk({
          bytes: 128,
          receipts: 1,
          retention: { maxAgeDays: 30, maxBytes: 4096, maxReceipts: 1000 },
        });
      }
      if (endpoint.startsWith("/api/egress/audits?")) {
        return apiOk({
          nextCursor: "opaque.cursor",
          receipts: [
            {
              action: "export",
              auditId: "audit-opaque",
              byteSize: 128,
              contentClass: "retrieval_trace",
              createdAtMs: 1,
              decision: "deny",
              destinationZone: "remote",
              effectivePolicy: "local_only",
              reasonCode: "POLICY_LOCAL_ONLY",
            },
          ],
        });
      }
      if (endpoint === "/api/egress/audits/audit-opaque") {
        if (init?.method === "DELETE") {
          return apiOk({
            auditId: "audit-opaque",
            checkpointedFrames: 2,
            deleted: 1,
            physicalCleanup: "complete",
            remainingWalFrames: 0,
          });
        }
        return apiOk({
          receipt: {
            auditId: "audit-opaque",
            byteSize: 128,
            effectivePolicy: "local_only",
            reasonCode: "POLICY_LOCAL_ONLY",
          },
        });
      }
      if (endpoint === "/api/egress/audits" && init?.method === "DELETE") {
        return apiOk({
          checkpointedFrames: 3,
          deleted: 1,
          physicalCleanup: "complete",
          remainingWalFrames: 0,
        });
      }
      return apiOk({});
    });
    const { CollectionModelDialog } =
      await import("../../../../src/serve/public/components/CollectionModelDialog");
    const { user } = renderWithUser(
      <CollectionModelDialog
        availableCollections={["private-notes", "public"]}
        collection={{
          chunkCount: 0,
          documentCount: 0,
          name: "private-notes",
          path: "/tmp/private",
          egressPolicy: {
            schemaVersion: "1.0",
            collection: "private-notes",
            configuredPolicy: null,
            effectivePolicy: "local_only",
            revision: 4,
            source: "config_default",
            version: `egress-policy-v1:${"a".repeat(64)}`,
          },
        }}
        onOpenChange={() => undefined}
        onSaved={() => undefined}
        open={true}
      />
    );
    const partialMode = screen.getByRole("combobox", {
      name: /partial mode/i,
    }) as HTMLSelectElement;
    expect(partialMode.disabled).toBeTrue();
    await user.type(
      screen.getByRole("searchbox", { name: /search collections/i }),
      "pub"
    );
    expect(
      screen.queryByRole("checkbox", { name: /private-notes/i })
    ).toBeNull();
    await user.click(
      screen.getByRole("checkbox", {
        name: "public",
      })
    );
    expect(partialMode.disabled).toBeFalse();

    await user.click(screen.getByRole("button", { name: "Explain" }));
    expect(
      (await screen.findAllByText(/POLICY_LOCAL_ONLY/)).length
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Keep the action local.")).toBeTruthy();
    expect(screen.getByText(/^denied · POLICY_LOCAL_ONLY$/)).toBeTruthy();

    await user.selectOptions(partialMode, "explicit");
    await user.click(screen.getByRole("button", { name: "Explain" }));
    expect(await screen.findByText(/EGRESS_PARTIAL_RESULT/)).toBeTruthy();
    expect(screen.getAllByText(/public/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/private-notes · POLICY_LOCAL_ONLY/)).toBeTruthy();
    const checkCalls = apiFetch.mock.calls.filter(
      ([endpoint]) => endpoint === "/api/egress/check"
    );
    const explicitRequest = checkCalls.at(-1)?.[1] as RequestInit;
    const explicitBody = explicitRequest.body;
    expect(
      JSON.parse(typeof explicitBody === "string" ? explicitBody : "{}")
    ).toMatchObject({
      collections: ["private-notes", "public"],
      partialResults: "explicit",
    });
    expect(await screen.findByText(/export \/ remote/)).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Delete audit receipt" })
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/cleanup complete/)).toBeTruthy();

    await user.click(
      screen.getByRole("checkbox", {
        name: "Confirm purge of all local audit receipts",
      })
    );
    await user.click(screen.getByRole("button", { name: "Purge audits" }));
    await waitFor(() =>
      expect(
        apiFetch.mock.calls.some(
          ([endpoint, init]) =>
            endpoint === "/api/egress/audits" &&
            (init as RequestInit | undefined)?.method === "DELETE"
        )
      ).toBeTrue()
    );
  });
});
