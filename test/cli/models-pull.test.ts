import { expect, mock, test } from "bun:test";

import type { Config } from "../../src/config/types";

import {
  formatModelsPull,
  modelsPull,
} from "../../src/cli/commands/models/pull";

const configWithReranker = (rerank: string): Config => ({
  version: "1.0" as const,
  ftsTokenizer: "unicode61" as const,
  collections: [],
  contexts: [],
  models: {
    activePreset: "test",
    loadTimeout: 60_000,
    inferenceTimeout: 30_000,
    expandContextSize: 2048,
    warmModelTtl: 300_000,
    presets: [
      {
        id: "test",
        name: "Test",
        embed: "hf:test/embed/model.gguf",
        rerank,
        expand: "hf:test/expand/model.gguf",
        gen: "hf:test/gen/model.gguf",
      },
    ],
  },
});

test.each([
  "http://localhost:8080/v1/completions#reranker",
  "https://models.example.test/rerank#model",
])("models pull skips external reranker %s", async (rerank) => {
  const isCached = mock(async () => {
    throw new Error("external reranker must not reach isCached");
  });
  const getCachedPath = mock(async () => {
    throw new Error("external reranker must not reach getCachedPath");
  });
  const download = mock(async () => {
    throw new Error("external reranker must not reach download");
  });

  const result = await modelsPull(
    {
      config: configWithReranker(rerank),
      rerank: true,
      force: true,
    },
    { cache: { isCached, getCachedPath, download } }
  );

  expect(isCached).not.toHaveBeenCalled();
  expect(getCachedPath).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
  expect(result).toEqual({
    results: [
      {
        type: "rerank",
        uri: rerank,
        ok: true,
        skipped: true,
        skipReason: "external",
      },
    ],
    failed: 0,
    skipped: 1,
  });
  expect(formatModelsPull(result)).toBe(
    "rerank: skipped (external endpoint)\n\nNo model downloads needed."
  );
});

test("models pull all bypasses only the external reranker", async () => {
  const rerank = "http://localhost:8080/rerank#model";
  const isCached = mock(async () => true);
  const getCachedPath = mock(async (uri: string) => `/cache/${uri.length}`);
  const download = mock(async () => {
    throw new Error("cached models must not download");
  });

  const result = await modelsPull(
    { config: configWithReranker(rerank), all: true },
    { cache: { isCached, getCachedPath, download } }
  );

  expect(isCached).toHaveBeenCalledTimes(3);
  expect(isCached.mock.calls.flat()).not.toContain(rerank);
  expect(getCachedPath).toHaveBeenCalledTimes(3);
  expect(download).not.toHaveBeenCalled();
  expect(result.failed).toBe(0);
  expect(result.skipped).toBe(4);
  expect(result.results.find(({ type }) => type === "rerank")).toMatchObject({
    ok: true,
    skipped: true,
    skipReason: "external",
  });
});
