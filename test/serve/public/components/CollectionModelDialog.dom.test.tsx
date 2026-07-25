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

    const requestOptions = apiFetch.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const rawBody = requestOptions?.body;
    const bodyText =
      typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody ?? {});
    const requestBody = JSON.parse(bodyText) as {
      models?: { embed?: string };
    };
    expect(apiFetch.mock.calls[0]?.[0]).toBe("/api/collections/docs");
    expect(requestOptions?.method).toBe("PATCH");
    expect(requestBody.models?.embed).toContain("Qwen3-Embedding-0.6B-GGUF");
  });

  test("requires visible version-bound confirmation before relaxing policy", async () => {
    apiFetch.mockImplementation(async () => apiOk({}));
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
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0]?.[0]).toBe(
      "/api/collections/private-notes/egress-policy"
    );
    const request = apiFetch.mock.calls[0]?.[1] as RequestInit;
    const body = request.body;
    expect(JSON.parse(typeof body === "string" ? body : "{}")).toMatchObject({
      policy: "remote",
      confirmation: {
        currentPolicy: "local_only",
        currentVersion: `egress-policy-v1:${"a".repeat(64)}`,
        acknowledged: true,
      },
    });
  });
});
