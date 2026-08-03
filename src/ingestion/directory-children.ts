/**
 * Bounded, single-level enumeration of the eligible direct children of one
 * directory inside a collection.
 *
 * `FileWalker.walk` always walks recursively from the collection root and has
 * no depth bound, so the watcher's directory reconciliation needs a narrower
 * seam. Eligibility is NOT forked here: every candidate goes through the same
 * `matchesWalkPath` the watcher already applies to exact event paths.
 *
 * @module src/ingestion/directory-children
 */

// node:fs - Dirent type for the readdir below
import type { Dirent } from "node:fs";

// node:fs/promises - Bun has no readdir/realpath equivalent
import { readdir, realpath } from "node:fs/promises";
// node:path - Bun has no path manipulation module
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { WalkConfig } from "./types";

import { normalizeCollectionDirRelPath } from "../core/path-rules";
import { matchesWalkPath } from "./walker";

/**
 * Three-state enumeration outcome.
 *
 * `missing` and `error` demand opposite caller behavior and must never collapse
 * into one empty array: a vanished directory still has to reconcile against the
 * indexed side so its children deactivate, while an unreadable directory must
 * fail closed so no deactivation is inferred from it.
 */
export type DirectoryChildrenOutcome =
  /** The directory was read; `relPaths` are the eligible direct children. */
  | { status: "present"; relPaths: string[] }
  /** The directory is genuinely gone (ENOENT / ENOTDIR). */
  | { status: "missing" }
  /** The directory could not be read, or the argument was refused. */
  | { status: "error"; cause: unknown };

/** Errno values that mean "this directory does not exist as a directory". */
const MISSING_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);

function isMissingError(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === "string" && MISSING_ERROR_CODES.has(code);
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.replaceAll(sep, "/");
}

/**
 * `Bun.Glob.scan` - the discovery step inside `FileWalker.walk` - never yields
 * dot-prefixed names, so a full collection sync never indexes them.
 * `matchesWalkPath` cannot express this because it is deliberately
 * filesystem-free and its glob `match()` DOES accept a leading dot. Applying it
 * here keeps directory reconciliation from indexing files a full `gno update`
 * would leave out. This is walker-discovery parity, not a fork of the
 * pattern/include/exclude rules, which stay entirely with `matchesWalkPath`.
 */
function isHiddenSegment(segment: string): boolean {
  return segment.startsWith(".");
}

function escapesRoot(rootReal: string, candidateReal: string): boolean {
  const rel = relative(rootReal, candidateReal);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * List the eligible direct children of `dirRelPath` inside `config.root`.
 *
 * - The collection root is `""` (also accepted as `"."` or `"/"`-padded forms).
 * - Never recurses: files in nested subdirectories are not returned.
 * - Discovery parity with `FileWalker.walk`'s `Bun.Glob.scan` step:
 *   - symlink entries are skipped entirely (`followSymlinks: false`), including
 *     symlinks resolving to a regular file inside the collection root;
 *     `Dirent.isFile()` uses `lstat` semantics, so this is exact parity;
 *   - dot-prefixed entries and dot-prefixed directories are skipped.
 *   Eligibility itself is never forked - it stays with `matchesWalkPath`.
 * - `maxBytes` is deliberately NOT enforced here. `matchesWalkPath` is
 *   filesystem-free and the watcher's existing exact-path filter is equally
 *   size-blind; `syncPaths` owns size enforcement, and statting every candidate
 *   before handing paths to it would only duplicate that work.
 * - Never throws: every failure is reported as `missing` or `error`.
 */
export async function listEligibleDirectChildren(
  dirRelPath: string,
  config: WalkConfig
): Promise<DirectoryChildrenOutcome> {
  const normalizedDir = normalizeCollectionDirRelPath(dirRelPath);
  if (normalizedDir === null) {
    return {
      status: "error",
      cause: new Error(
        `Directory path escapes the collection root: ${dirRelPath}`
      ),
    };
  }

  let rootReal: string;
  try {
    rootReal = await realpath(resolve(config.root));
  } catch (cause) {
    return isMissingError(cause)
      ? { status: "missing" }
      : { status: "error", cause };
  }

  let dirReal: string;
  try {
    dirReal = await realpath(
      normalizedDir === "" ? rootReal : resolve(rootReal, normalizedDir)
    );
  } catch (cause) {
    return isMissingError(cause)
      ? { status: "missing" }
      : { status: "error", cause };
  }

  // A symlinked directory can resolve outside the collection root even though
  // the relative argument looked contained. Fail closed rather than enumerate.
  if (escapesRoot(rootReal, dirReal)) {
    return {
      status: "error",
      cause: new Error(
        `Directory path escapes the collection root: ${dirRelPath}`
      ),
    };
  }

  let entries: Dirent[];
  try {
    entries = await readdir(dirReal, { withFileTypes: true });
  } catch (cause) {
    return isMissingError(cause)
      ? { status: "missing" }
      : { status: "error", cause };
  }

  // Use the realpath-derived prefix so the returned paths are the same ones
  // FileWalker.walk would produce for these files.
  const prefix = toPosix(relative(rootReal, dirReal));
  if (prefix.split("/").some(isHiddenSegment)) {
    // A dot-prefixed directory is never walked, so it has no eligible children.
    return { status: "present", relPaths: [] };
  }

  const relPaths: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || isHiddenSegment(entry.name)) {
      continue;
    }
    const childRelPath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (matchesWalkPath(childRelPath, config)) {
      relPaths.push(childRelPath);
    }
  }

  relPaths.sort((a, b) => a.localeCompare(b));
  return { status: "present", relPaths };
}
