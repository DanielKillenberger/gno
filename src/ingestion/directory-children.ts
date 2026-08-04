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

// node:fs - Dirent/Stats types for the readdir and lstat calls below
import type { Dirent, Stats } from "node:fs";

// node:fs/promises - Bun has no readdir/realpath/stat equivalent (Bun.file()
// answers only for regular files, so it cannot test a DIRECTORY's existence)
import { lstat, readdir, realpath, stat } from "node:fs/promises";
// node:path - Bun has no path manipulation module
import { isAbsolute, join, relative, resolve, sep } from "node:path";

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
   * - `false` - no ancestor of the reported path was observed missing;
   *   `directory` is its surviving parent.
   *
   * `false` is NOT the claim that the vanished path was a file. Nothing here
   * can make that claim: a directory may legitimately carry a filename-shaped
   * name, and a `*.md` collection pattern matches the directory `archive.md`
   * exactly as it matches a document. Once the path is gone the disk cannot
   * say which it was either. The caller must treat the reported path as
   * a POSSIBLE directory and discriminate on the INDEXED side - active indexed
   * descendants mean a removed subtree, none means an ordinary vanished file.
   * That decision deliberately lives with the caller: this module is
   * filesystem-only and holds no store dependency.
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
    // Nothing ABOVE the reported path was observed missing, so the survivor is
    // the reconciled area. The reported path itself may still have been a
    // directory - see `VanishedPathOutcome.directoryRemoved`; that is the
    // caller's discriminator to make against the indexed side, not a question
    // this string walk can answer.
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
 * Optional seams for the enumeration below.
 *
 * `beforeReadDirectory` is awaited immediately before each `readdir`, once that
 * directory has been proven contained. It exists so the swap race the
 * traversal-time containment check closes can be driven DETERMINISTICALLY in a
 * test - replacing a directory with a symlink exactly inside the window - rather
 * than raced against a sleep. Production callers never pass it, and a hook that
 * throws is folded into the ordinary `error` outcome like any other failure, so
 * the never-throws contract holds.
 */
export interface DirectoryEnumerationHooks {
  beforeReadDirectory?: (absPath: string) => void | Promise<void>;
}

/** Everything the recursion carries that is the same at every level. */
interface EnumerationContext {
  config: WalkConfig;
  recursive: boolean;
  /** The collection root, fully resolved. Containment is measured against it. */
  rootReal: string;
  out: string[];
  hooks: DirectoryEnumerationHooks | undefined;
}

/** One directory read that was proven contained at the moment it was read. */
type ContainedRead =
  | { status: "read"; entries: Dirent[] }
  /** Not a directory any more (or never was): gone, or a symlink in its place. */
  | { status: "missing" }
  | { status: "error"; cause: unknown };

/**
 * Read one directory, proving AT READ TIME that it is a real directory inside
 * the collection root - and that it was still the same directory afterwards.
 *
 * Containment established once before a walk is not containment: a directory
 * replaced by a symlink after that check but before its `readdir` is followed by
 * the `readdir`, and the files under it are then returned under
 * collection-relative names and handed to `syncPaths`, which follows the same
 * symlink and indexes content from outside the collection. A `Dirent` that said
 * "directory" is evidence about the instant the parent was listed and nothing
 * more, so descending on the strength of it has the same window.
 *
 * Three checks, in order, close it:
 *
 * 1. `lstat` - no-follow, so a symlink standing where a directory was is simply
 *    not a directory here. That is the SAME policy `Dirent.isDirectory()`
 *    applies to entries, so nothing changes about what is ELIGIBLE; it only
 *    stops a stale `Dirent` from being trusted after the fact.
 * 2. `realpath` + containment, immediately before the read. This is what proves
 *    every `readdir` target - not just the top one - is inside the root at the
 *    moment it is read, including when the swap happened to an ANCESTOR.
 * 3. `lstat` again after the read, comparing `(dev, ino)`. A swap landing
 *    between the containment proof and the `readdir` cannot change what that
 *    `readdir` already returned, but it can change what it returned it FROM, so
 *    the identity is re-proven and a changed inode fails the whole enumeration
 *    closed rather than reporting foreign files.
 */
async function readContainedDirectory(
  dirPath: string,
  context: EnumerationContext
): Promise<ContainedRead> {
  let before: Stats;
  try {
    before = await lstat(dirPath);
  } catch (cause) {
    return isMissingError(cause)
      ? { status: "missing" }
      : { status: "error", cause };
  }
  if (!before.isDirectory()) {
    return { status: "missing" };
  }

  let real: string;
  try {
    real = await realpath(dirPath);
  } catch (cause) {
    return isMissingError(cause)
      ? { status: "missing" }
      : { status: "error", cause };
  }
  if (escapesRoot(context.rootReal, real)) {
    return {
      status: "error",
      cause: new Error(
        `Directory path escapes the collection root: ${dirPath}`
      ),
    };
  }

  let entries: Dirent[];
  try {
    await context.hooks?.beforeReadDirectory?.(dirPath);
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (cause) {
    return isMissingError(cause)
      ? { status: "missing" }
      : { status: "error", cause };
  }

  let after: Stats;
  try {
    after = await lstat(dirPath);
  } catch (cause) {
    return isMissingError(cause)
      ? { status: "missing" }
      : { status: "error", cause };
  }
  if (
    !(
      after.isDirectory() &&
      after.dev === before.dev &&
      after.ino === before.ino
    )
  ) {
    return {
      status: "error",
      cause: new Error(
        `Directory was replaced while it was being read: ${dirPath}`
      ),
    };
  }

  return { status: "read", entries };
}

/** What the UNRESOLVED entry-point path turned out to be, before any deref. */
type EntryPathCheck =
  /** Every component below the root is a real directory. Enumerate it. */
  | { status: "walkable" }
  /**
   * A component below the root - the requested directory itself, or one of its
   * ancestors - is a symlink. `FileWalker.walk` never descends into one, so
   * neither may this seam.
   */
  | { status: "symlink" }
  /** A component is gone, or stands where a directory is required. */
  | { status: "missing" }
  | { status: "error"; cause: unknown };

/**
 * Prove the requested directory is reachable from the collection root WITHOUT
 * dereferencing anything on the way.
 *
 * `realpath` on the argument answers "where does this end up", which is the
 * wrong question for the entry point: it silently dereferences an in-root alias
 * (`root/alias -> root/real`), and every later check - including the read-time
 * containment proof - then sees the TARGET, so the no-follow guarantee held for
 * nested levels but not for the requested directory or its ancestors. That
 * contradicts walker parity, where a symlinked directory is skipped outright
 * (`Dirent.isDirectory()` has `lstat` semantics, `Bun.Glob.scan` runs with
 * `followSymlinks: false`).
 *
 * Only components BELOW the root are checked. The collection root itself is
 * canonicalized as before and deliberately so: it is legitimately a symlink on
 * macOS (`/tmp -> /private/tmp`), and refusing to walk a collection for that
 * reason would break every temp-rooted collection.
 */
async function checkUnresolvedEntryPath(
  rootReal: string,
  normalizedDir: string
): Promise<EntryPathCheck> {
  if (normalizedDir === "") {
    return { status: "walkable" };
  }
  let current = rootReal;
  for (const segment of normalizedDir.split("/")) {
    current = join(current, segment);
    let info: Stats;
    try {
      info = await lstat(current);
    } catch (cause) {
      return isMissingError(cause)
        ? { status: "missing" }
        : { status: "error", cause };
    }
    // Checked BEFORE `isDirectory()`: `lstat` reports a symlink as a symlink
    // whatever it points at, which is the whole point of asking no-follow.
    if (info.isSymbolicLink()) {
      return { status: "symlink" };
    }
    if (!info.isDirectory()) {
      // A file standing where a directory component is required - the same
      // thing `realpath` reported as ENOTDIR, and the same outcome.
      return { status: "missing" };
    }
  }
  return { status: "walkable" };
}

/**
 * Read one directory and collect its eligible files, descending only when
 * `context.recursive` is set.
 *
 * Returns `null` on success and a terminal outcome otherwise. A NESTED
 * directory that vanished mid-walk contributes nothing and is not an outcome:
 * only the enumerated top directory going missing means `missing`. Any other
 * failure, at any depth, fails the whole enumeration closed - the caller must
 * never read a partially readable subtree as an authoritative file list.
 *
 * Symlinks are never followed: `Dirent.isDirectory()` has `lstat` semantics, so
 * a symlinked directory is neither descended into nor listed, and
 * `readContainedDirectory` re-proves that at the moment of the read. That is
 * both parity with `FileWalker.walk` and what makes the recursion loop-free.
 */
async function collectEligibleFiles(
  dirPath: string,
  prefix: string,
  isTop: boolean,
  context: EnumerationContext
): Promise<DirectoryChildrenOutcome | null> {
  const read = await readContainedDirectory(dirPath, context);
  if (read.status === "missing") {
    return isTop ? { status: "missing" } : null;
  }
  if (read.status === "error") {
    return { status: "error", cause: read.cause };
  }

  const subdirectories: Array<{ path: string; prefix: string }> = [];
  for (const entry of read.entries) {
    if (isHiddenSegment(entry.name)) {
      continue;
    }
    const childRelPath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isFile()) {
      if (matchesWalkPath(childRelPath, context.config)) {
        context.out.push(childRelPath);
      }
      continue;
    }
    if (context.recursive && entry.isDirectory()) {
      subdirectories.push({
        path: join(dirPath, entry.name),
        prefix: childRelPath,
      });
    }
  }

  for (const subdirectory of subdirectories) {
    const failure = await collectEligibleFiles(
      subdirectory.path,
      subdirectory.prefix,
      false,
      context
    );
    if (failure) {
      return failure;
    }
  }
  return null;
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
 *   - the REQUESTED directory and its ancestors get the same treatment: a
 *     symlink anywhere below the root is not walked into, so an in-root alias
 *     reports no eligible children instead of the target's files;
 *   - dot-prefixed entries and dot-prefixed directories are skipped.
 *   Eligibility itself is never forked - it stays with `matchesWalkPath`.
 * - Containment is proven at READ time, not once before the read - see
 *   `readContainedDirectory`.
 * - `maxBytes` is deliberately NOT enforced here. `matchesWalkPath` is
 *   filesystem-free and the watcher's existing exact-path filter is equally
 *   size-blind; `syncPaths` owns size enforcement, and statting every candidate
 *   before handing paths to it would only duplicate that work.
 * - Never throws: every failure is reported as `missing` or `error`.
 */
export function listEligibleDirectChildren(
  dirRelPath: string,
  config: WalkConfig,
  hooks?: DirectoryEnumerationHooks
): Promise<DirectoryChildrenOutcome> {
  return enumerateEligible(dirRelPath, config, false, hooks);
}

/**
 * List every eligible file anywhere beneath `dirRelPath` inside `config.root`.
 *
 * Same seam, same eligibility, same containment and discovery parity as
 * `listEligibleDirectChildren` - it only descends.
 *
 * This exists for exactly one case: a directory whose REMOVAL was already
 * established when the event was classified, and which EXISTS again by the time
 * the flush enumerates it (an editor that rewrites a tree, a checkout, a
 * restore). The removal intent is carried on the queue so the indexed side
 * still answers for the whole subtree, but a direct-children disk read then
 * describes only the top level of the recreated tree, so a file written into a
 * recreated NESTED directory appears in neither half of the union and stays
 * unindexed - indefinitely on Linux, where writes inside a directory created
 * after the watch began emit no events at all (bun#15939).
 *
 * It stays bounded: rooted at that one directory, never at the collection,
 * eligibility-filtered per candidate, contained by a realpath check re-proven at
 * every level AS it descends (`readContainedDirectory`), and symlink-free so it
 * cannot walk out of the subtree or loop. It costs disk
 * reads only - one `readdir` per recreated subdirectory - and adds no store
 * round trips at all.
 */
export function listEligibleSubtreeFiles(
  dirRelPath: string,
  config: WalkConfig,
  hooks?: DirectoryEnumerationHooks
): Promise<DirectoryChildrenOutcome> {
  return enumerateEligible(dirRelPath, config, true, hooks);
}

async function enumerateEligible(
  dirRelPath: string,
  config: WalkConfig,
  recursive: boolean,
  hooks: DirectoryEnumerationHooks | undefined
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

  const dirAbs =
    normalizedDir === "" ? rootReal : resolve(rootReal, normalizedDir);

  // The entry point and its ancestors are examined NO-FOLLOW first, so a
  // symlink standing anywhere below the root is never dereferenced into an
  // enumeration.
  const entryCheck = await checkUnresolvedEntryPath(rootReal, normalizedDir);
  if (entryCheck.status === "missing") {
    return { status: "missing" };
  }
  if (entryCheck.status === "error") {
    return { status: "error", cause: entryCheck.cause };
  }

  let dirReal: string;
  try {
    dirReal = await realpath(dirAbs);
  } catch (cause) {
    return isMissingError(cause)
      ? { status: "missing" }
      : { status: "error", cause };
  }

  // A symlinked directory can resolve outside the collection root even though
  // the relative argument looked contained. Fail closed rather than enumerate.
  // This is the ARGUMENT check - it says the requested path was contained when
  // it was resolved, which is why it can report the caller's `dirRelPath`. It is
  // NOT what keeps the traversal contained; every directory actually read is
  // re-proven contained at read time by `readContainedDirectory`.
  //
  // On a symlinked entry point this resolution is used to CLASSIFY, never to
  // enumerate: nothing is read through it either way (see below).
  if (escapesRoot(rootReal, dirReal)) {
    return {
      status: "error",
      cause: new Error(
        `Directory path escapes the collection root: ${dirRelPath}`
      ),
    };
  }

  if (entryCheck.status === "symlink") {
    // An in-root alias (`root/alias -> root/real`). `FileWalker.walk` skips a
    // symlinked directory outright, so a full sync indexes nothing under
    // `alias/...`; reporting no eligible children converges the indexed side on
    // exactly that, and is the same answer the dot-prefixed branch below gives
    // for a directory the walker never enters. What is NOT allowed is what the
    // realpath-first version did: enumerate the TARGET and report its files
    // under the alias' collection-relative names.
    return { status: "present", relPaths: [] };
  }

  // No component below the root is a symlink, so the unresolved path IS the
  // canonical one - and it is the path used from here on, so nothing that
  // appears after this point can be reached through a dereferenced entry point.
  const prefix = toPosix(relative(rootReal, dirAbs));
  if (prefix.split("/").some(isHiddenSegment)) {
    // A dot-prefixed directory is never walked, so it has no eligible children.
    return { status: "present", relPaths: [] };
  }

  const relPaths: string[] = [];
  const failure = await collectEligibleFiles(dirAbs, prefix, true, {
    config,
    recursive,
    rootReal,
    out: relPaths,
    hooks,
  });
  if (failure) {
    return failure;
  }

  relPaths.sort((a, b) => a.localeCompare(b));
  return { status: "present", relPaths };
}
