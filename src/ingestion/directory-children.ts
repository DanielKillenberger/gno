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

// node:fs/promises - Bun has no readdir/realpath/stat equivalent (Bun.file()
// answers only for regular files, so it cannot test a DIRECTORY's existence)
import { readdir, realpath, stat } from "node:fs/promises";
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
 * What a reported event path turned out to be, once the disk was consulted.
 *
 * `present` is the ordinary live-edit case and carries no directory work at
 * all; `removed` names the area a vanished path implicates; `error` fails
 * closed, exactly like the enumeration outcome above.
 */
export type VanishedPathOutcome =
  /** The reported path still exists: the event named the whole change. */
  | { status: "present" }
  /**
   * The reported path is gone. `directory` is the SHALLOWEST ancestor that is
   * also gone, or the path's own (surviving) parent directory when only the
   * file itself vanished.
   *
   * `directoryRemoved` says which of those two it is, and it is the CLASSIFICATION
   * the caller must carry forward rather than re-derive:
   *
   * - `true` - `directory` itself was OBSERVED missing on disk (including the
   *   collection root). Everything indexed beneath it, at any depth, is
   *   implicated.
   * - `false` - only the file vanished; `directory` survived and is reconciled
   *   against its direct children alone.
   *
   * A caller that re-stats `directory` later can see a RECREATED directory and
   * silently narrow a subtree removal to its direct children. The flag exists so
   * the removal intent survives that recreation.
   */
  | { status: "removed"; directory: string; directoryRemoved: boolean }
  /** The disk could not be consulted; nothing may be inferred. */
  | { status: "error"; cause: unknown };

/** Does `absPath` exist (as anything) on disk? */
async function pathExists(
  absPath: string
): Promise<boolean | { cause: unknown }> {
  try {
    await stat(absPath);
    return true;
  } catch (cause) {
    return isMissingError(cause) ? false : { cause };
  }
}

/**
 * Resolve the directory a reported event path implicates, by asking the disk
 * whether that path still exists.
 *
 * This exists because a filesystem event that names an ELIGIBLE file is not
 * automatically a complete report. Measured on Bun 1.3.14 / Linux / ext4, a
 * recursive delete of `dir1/` holding `a.md` and `b.md` reports exactly one
 * arbitrary surviving-name child (`dir1/b.md` on hardware, `dir1/a.md` in a
 * container) and nothing else - so trusting it deactivates one file and leaves
 * its siblings active forever. Bun 1.3.11 reported the directory instead. The
 * event shape is not stable across Bun patch releases; the disk is.
 *
 * - The path still exists (a live edit, the overwhelmingly common case):
 *   `present`, and the caller keeps its narrow per-path flow. This is what
 *   keeps the hot path unwidened.
 * - The path is gone but its parent survives: `removed` with the parent, so a
 *   bounded direct-children reconciliation of that one directory runs.
 * - The path AND one or more ancestors are gone: `removed` with the shallowest
 *   removed ancestor, so the whole removed subtree can be reconciled. The
 *   reported child may be at any depth, and its parent may itself have been
 *   removed, which is why this walks rather than taking `dirname` once.
 *
 * The walk never climbs PAST the collection root - the root is the ceiling, and
 * that ceiling is what keeps a deletion from escalating into "reconcile
 * everything above the collection". But the ceiling is not the same claim as
 * "the root still exists". When the walk reaches the root it asks the disk one
 * more question:
 *
 * - the root is there (the ordinary case): `""` is the reconciled area and only
 *   its direct children are implicated;
 * - the root is genuinely ABSENT (`ENOENT`/`ENOTDIR` - the collection directory
 *   was deleted or unmounted): `""` is returned with `directoryRemoved: true`,
 *   so every document indexed under the collection deactivates. Treating the
 *   root as always surviving left exactly those documents active forever;
 * - the root could not be STATTED at all (`EACCES`, `EIO`, a hung mount): that
 *   is not evidence of absence, so it fails closed as `error` and nothing is
 *   deactivated on the strength of it.
 */
export async function resolveVanishedPathDirectory(
  relPath: string,
  root: string
): Promise<VanishedPathOutcome> {
  const normalized = normalizeCollectionDirRelPath(relPath);
  if (normalized === null || normalized === "") {
    return {
      status: "error",
      cause: new Error(`Path escapes the collection root: ${relPath}`),
    };
  }

  const rootReal = resolve(root);
  const reported = await pathExists(resolve(rootReal, normalized));
  if (reported === true) {
    return { status: "present" };
  }
  if (reported !== false) {
    return { status: "error", cause: reported.cause };
  }

  let directory = parentDirectoryOf(normalized);
  while (directory !== "") {
    const exists = await pathExists(resolve(rootReal, directory));
    if (exists === true) {
      break;
    }
    if (exists !== false) {
      return { status: "error", cause: exists.cause };
    }
    directory = parentDirectoryOf(directory);
  }

  if (directory === "") {
    // The walk stopped at the ceiling without ever proving the root is there.
    // Absence and unreadability demand opposite behavior, so ask explicitly.
    const rootPresent = await pathExists(rootReal);
    if (rootPresent !== true) {
      return rootPresent === false
        ? // The collection directory itself is gone: everything indexed under
          // it is implicated, not just the root's direct children.
          { status: "removed", directory: "", directoryRemoved: true }
        : // Unreadable, not absent - infer nothing.
          { status: "error", cause: rootPresent.cause };
    }
  }

  // `directory` now names a surviving ancestor (or the surviving root). The
  // area to reconcile is the child of it that is gone - or, when nothing above
  // the file was removed, that surviving directory itself.
  const removedChild = shallowestRemovedChild(normalized, directory);
  return {
    status: "removed",
    directory: removedChild,
    // The survivor itself is only reconciled for its direct children; anything
    // below it was observed gone.
    directoryRemoved: removedChild !== directory,
  };
}

/** The directory portion of a normalized collection-relative path. */
function parentDirectoryOf(relPath: string): string {
  const lastSlash = relPath.lastIndexOf("/");
  return lastSlash === -1 ? "" : relPath.slice(0, lastSlash);
}

/**
 * Given the vanished path and the deepest SURVIVING ancestor directory, return
 * the directory to reconcile: the removed directory just below the survivor,
 * or the survivor itself when the vanished path was its direct child.
 */
function shallowestRemovedChild(
  vanishedRelPath: string,
  survivingDirectory: string
): string {
  if (parentDirectoryOf(vanishedRelPath) === survivingDirectory) {
    // Only the file itself vanished: reconcile the directory it lived in.
    return survivingDirectory;
  }
  const rest =
    survivingDirectory === ""
      ? vanishedRelPath
      : vanishedRelPath.slice(survivingDirectory.length + 1);
  const firstSegment = rest.slice(0, rest.indexOf("/"));
  return survivingDirectory === ""
    ? firstSegment
    : `${survivingDirectory}/${firstSegment}`;
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
