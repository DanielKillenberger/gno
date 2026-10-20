/**
 * Validate caller-supplied paths for a path-level reindex.
 *
 * @module src/core/reindex-paths
 */

// node:fs/promises realpath and node:path have no Bun equivalent.
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { Collection } from "../config/types";

import { MCP_ERRORS } from "./errors";

const escapes = (rel: string): boolean =>
  rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

const toPosix = (rel: string): string => rel.split(sep).join("/");

const missing = (error: unknown): boolean =>
  error !== null &&
  typeof error === "object" &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

/** Realpath of `path`, or of its nearest existing ancestor below `root`. */
async function nearestRealpath(
  path: string,
  root: string
): Promise<string | null> {
  let current = path;
  for (;;) {
    try {
      return await realpath(current);
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const parent = dirname(current);
    if (parent === current || relative(root, parent) === "") return null;
    current = parent;
  }
}

/**
 * Resolve paths (relative to the collection root, or absolute inside it) to
 * deduplicated collection-relative POSIX paths. A path that no longer exists
 * is kept so the sync can mark it inactive. Throws `INVALID_INPUT: ...` for an
 * empty list and `INVALID_PATH: ...` for a path outside the root, including
 * one that leaves it through a symlink.
 */
export async function resolveReindexPaths(
  collection: Collection,
  paths: readonly unknown[]
): Promise<string[]> {
  if (paths.length === 0) {
    throw new Error(
      `${MCP_ERRORS.INVALID_INPUT.code}: paths must list at least one path`
    );
  }
  const root = resolve(collection.path);
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    realRoot = root;
  }
  const resolved = new Set<string>();
  for (const path of paths) {
    if (typeof path !== "string" || path.trim() === "") {
      throw new Error(
        `${MCP_ERRORS.INVALID_INPUT.code}: paths must be non-empty strings`
      );
    }
    const absolute = resolve(root, path);
    const rel = relative(root, absolute);
    if (escapes(rel)) {
      throw new Error(
        `${MCP_ERRORS.INVALID_PATH.code}: ${path} is outside collection ${collection.name}`
      );
    }
    // A missing file is checked through its nearest existing folder, so a
    // deletion path cannot leave the root through a symlinked parent.
    const real = await nearestRealpath(absolute, root);
    if (
      real !== null &&
      escapes(relative(realRoot, real)) &&
      real !== realRoot
    ) {
      throw new Error(
        `${MCP_ERRORS.INVALID_PATH.code}: ${path} resolves outside collection ${collection.name}`
      );
    }
    resolved.add(toPosix(rel));
  }
  return [...resolved];
}

/**
 * Resolve an optional path list for a reindex request. Paths need a single
 * collection and apply to a plain sync: git pull and update commands act on
 * the whole collection, so they cannot be combined with paths.
 */
export async function resolveReindexScope(
  collection: Collection | null,
  paths: readonly unknown[] | undefined,
  options: { gitPull?: boolean; runUpdateCmd?: boolean } = {}
): Promise<string[] | null> {
  if (paths === undefined) return null;
  if (!collection) {
    throw new Error(
      `${MCP_ERRORS.INVALID_INPUT.code}: paths require a collection`
    );
  }
  if (options.gitPull || options.runUpdateCmd) {
    throw new Error(
      `${MCP_ERRORS.INVALID_INPUT.code}: paths cannot be combined with gitPull or an update command`
    );
  }
  return resolveReindexPaths(collection, paths);
}
