/**
 * gno models pull command implementation.
 * Download models to local cache.
 *
 * @module src/cli/commands/models/pull
 */

import type { DownloadProgress, ModelType } from "../../../llm/types";

import { getModelsCachePath } from "../../../app/constants";
import { loadConfig } from "../../../config";
import { ModelCache } from "../../../llm/cache";
import { isHttpRerankUri } from "../../../llm/httpRerank";
import { getActivePreset } from "../../../llm/registry";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelsPullOptions {
  /** Override config path */
  configPath?: string;
  /** Override config object (takes precedence over configPath) */
  config?: import("../../../config/types").Config;
  /** Pull all models */
  all?: boolean;
  /** Pull embedding model */
  embed?: boolean;
  /** Pull reranker model */
  rerank?: boolean;
  /** Pull expansion model */
  expand?: boolean;
  /** Pull generation model */
  gen?: boolean;
  /** Force re-download */
  force?: boolean;
  /** Progress callback for UI (omit to disable progress) */
  onProgress?: (type: ModelType, progress: DownloadProgress) => void;
  /** Stop before the next model and suppress subsequent work. */
  signal?: AbortSignal;
}

export interface ModelPullResult {
  type: ModelType;
  uri: string;
  ok: boolean;
  error?: string;
  path?: string;
  skipped?: boolean;
  skipReason?: "cached" | "external";
}

export interface ModelsPullResult {
  results: ModelPullResult[];
  failed: number;
  skipped: number;
}

export interface ModelsPullDependencies {
  cache?: Pick<ModelCache, "download" | "getCachedPath" | "isCached">;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine which model types to pull based on options.
 */
function getTypesToPull(options: ModelsPullOptions): ModelType[] {
  if (options.all) {
    return ["embed", "rerank", "expand", "gen"];
  }
  if (options.embed || options.rerank || options.expand || options.gen) {
    const types: ModelType[] = [];
    if (options.embed) {
      types.push("embed");
    }
    if (options.rerank) {
      types.push("rerank");
    }
    if (options.expand) {
      types.push("expand");
    }
    if (options.gen) {
      types.push("gen");
    }
    return types;
  }
  // Default: pull all
  return ["embed", "rerank", "expand", "gen"];
}

/**
 * Execute gno models pull command.
 */
export async function modelsPull(
  options: ModelsPullOptions = {},
  deps: ModelsPullDependencies = {}
): Promise<ModelsPullResult> {
  // Use provided config, or load from disk (use defaults if not initialized)
  let config = options.config;
  if (!config) {
    const { createDefaultConfig } = await import("../../../config");
    const configResult = await loadConfig(options.configPath);
    config = configResult.ok ? configResult.value : createDefaultConfig();
  }

  const preset = getActivePreset(config);
  const cache = deps.cache ?? new ModelCache(getModelsCachePath());
  const types = getTypesToPull(options);

  const results: ModelPullResult[] = [];
  let failed = 0;
  let skipped = 0;

  for (const type of types) {
    if (options.signal?.aborted) break;
    const uri =
      type === "expand" ? (preset.expand ?? preset.gen) : preset[type];

    // HTTP rerankers are services, not model artifacts. They are loaded
    // directly by LlmAdapter and must never enter the local model cache path.
    if (type === "rerank" && isHttpRerankUri(uri)) {
      results.push({
        type,
        uri,
        ok: true,
        skipped: true,
        skipReason: "external",
      });
      skipped += 1;
      continue;
    }

    // Check if already cached (skip unless --force)
    if (!options.force) {
      const isCached = await cache.isCached(uri);
      if (isCached) {
        const path = await cache.getCachedPath(uri);
        results.push({
          type,
          uri,
          ok: true,
          path: path ?? undefined,
          skipped: true,
          skipReason: "cached",
        });
        skipped += 1;
        continue;
      }
    }

    // Download the model
    const result = await cache.download(
      uri,
      type,
      (progress) => {
        options.onProgress?.(type, progress);
      },
      options.force,
      options.signal
    );
    if (options.signal?.aborted) break;

    if (result.ok) {
      results.push({
        type,
        uri,
        ok: true,
        path: result.value,
      });
    } else {
      results.push({
        type,
        uri,
        ok: false,
        error: result.error.message,
      });
      failed += 1;
    }
  }

  return { results, failed, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format models pull result for output.
 */
export function formatModelsPull(result: ModelsPullResult): string {
  const lines: string[] = [];
  let externalSkipped = 0;
  const label = (type: ModelType) =>
    type === "gen" ? "answer" : type === "expand" ? "expand" : type;

  for (const r of result.results) {
    if (r.ok) {
      if (r.skipped) {
        if (r.skipReason === "external") externalSkipped += 1;
        const reason =
          r.skipReason === "external" ? "external endpoint" : "already cached";
        lines.push(`${label(r.type)}: skipped (${reason})`);
      } else {
        lines.push(`${label(r.type)}: downloaded`);
      }
    } else {
      lines.push(`${label(r.type)}: failed - ${r.error}`);
    }
  }

  if (result.failed > 0) {
    lines.push("");
    lines.push(`${result.failed} model(s) failed to download.`);
  } else if (result.skipped === result.results.length) {
    lines.push("");
    lines.push(
      externalSkipped > 0
        ? "No model downloads needed."
        : "All models already cached. Use --force to re-download."
    );
  } else {
    lines.push("");
    lines.push(
      externalSkipped > 0
        ? "All downloadable models downloaded successfully."
        : "All models downloaded successfully."
    );
  }

  return lines.join("\n");
}
