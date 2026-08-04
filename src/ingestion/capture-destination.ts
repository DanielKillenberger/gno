/**
 * Destination safety for every path GNO itself WRITES into a collection.
 *
 * The walker's no-follow reachability policy lives in exactly one place
 * (`checkWalkPathVisibility`, beside `matchesWalkPath`) and `syncPaths` resolves
 * every candidate through it. That is right for READS: a path the walker cannot
 * reach reads as gone, and an indexed document under an alias deactivates.
 *
 * It is not sufficient for WRITES. `mkdir(dir, { recursive: true })` does NOT
 * guarantee real directories - it happily FOLLOWS an existing directory symlink
 * - so a capture beneath `alias -> real/` (or worse, `alias -> /outside`) writes
 * the file through the alias and only THEN asks the index about it. The index
 * correctly answers "not reachable", and a caller that treats any non-`error`
 * sync result as success reports a successful capture of a file that is not
 * indexed, or - for an escaping alias - of a file written outside the collection
 * entirely. Both halves of that failure are fixed here:
 *
 * - `prepareCaptureDestination` proves and creates the parent chain BEFORE the
 *   write, component by component, refusing to follow any symlink below the
 *   collection root. Nothing is written through an alias, and an escaping alias
 *   is still reported as a containment error.
 * - `requireActiveCaptureDocument` is the proof a caller must demand AFTER the
 *   write: an ACTIVE document must actually exist for the path. "The sync
 *   result was not an error" is not that proof - `skipped` and `unchanged` are
 *   both non-errors and neither implies an indexed document.
 *
 * The policy itself is NOT restated here. Reachability is asked of
 * `checkWalkPathVisibility` exactly as `syncPaths` and `directory-children` ask
 * it, so the write path, the enumeration seam and a full `gno update` cannot
 * disagree about what is indexable.
 *
 * @module src/ingestion/capture-destination
 */

// node:fs/promises structure/link operations have no Bun equivalent.
import { mkdir, readlink, realpath } from "node:fs/promises";
// node:path has no Bun path utilities.
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { DocumentRow, StorePort } from "../store/types";

import { normalizeCollectionDirRelPath } from "../core/path-rules";
import { checkWalkPathVisibility } from "./walker";

/**
 * Why a destination was refused.
 *
 * `PATH_OUTSIDE_COLLECTION` is deliberately the same name `syncPaths` reports
 * for a containment failure: an alias pointing out of the collection has to stay
 * a containment error whichever side observes it first.
 */
export type CaptureDestinationErrorCode =
  | "PATH_OUTSIDE_COLLECTION"
  | "PATH_NOT_WALKABLE"
  | "PATH_UNRESOLVED"
  | "NOT_DIRECTORY";

/** Refusal to write at a destination the indexer could never reach. */
export class CaptureDestinationError extends Error {
  readonly code: CaptureDestinationErrorCode;
  readonly relPath: string;

  constructor(
    code: CaptureDestinationErrorCode,
    message: string,
    relPath: string
  ) {
    super(message);
    this.name = "CaptureDestinationError";
    this.code = code;
    this.relPath = relPath;
  }
}

/** True when `candidate` is at or below `rootReal`. */
function isContained(rootReal: string, candidate: string): boolean {
  const rel = relative(rootReal, candidate);
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * Classify a symlink component: does it escape the collection, or is it merely
 * out of the walker's reach?
 *
 * Both are refusals, but they are not the same refusal, and the distinction is
 * user-visible: an escaping alias is a containment failure and must not be
 * softened into "not indexable".
 */
async function classifySymlinkComponent(
  collectionPath: string,
  absPath: string,
  relPath: string
): Promise<CaptureDestinationError> {
  let rootReal: string;
  try {
    rootReal = await realpath(collectionPath);
  } catch {
    return new CaptureDestinationError(
      "PATH_UNRESOLVED",
      `Collection root could not be resolved while validating ${relPath}.`,
      relPath
    );
  }

  let target: string;
  try {
    const link = await readlink(absPath);
    target = isAbsolute(link) ? link : resolve(dirname(absPath), link);
  } catch {
    return new CaptureDestinationError(
      "PATH_UNRESOLVED",
      `Symlink ${absPath} could not be read while validating ${relPath}.`,
      relPath
    );
  }

  // A DANGLING alias still has a destination; fall back to the lexical target
  // so `alias -> /outside/missing` is reported as containment, not as unreadable.
  let resolved = target;
  try {
    resolved = await realpath(target);
  } catch {
    resolved = target;
  }

  if (isContained(rootReal, resolved)) {
    return new CaptureDestinationError(
      "PATH_NOT_WALKABLE",
      `Refusing to write ${relPath}: ${absPath} is a symlink, and the indexer never follows symlinks below the collection root, so the file would not be indexed.`,
      relPath
    );
  }
  return new CaptureDestinationError(
    "PATH_OUTSIDE_COLLECTION",
    `Refusing to write ${relPath}: ${absPath} is a symlink resolving outside the collection root.`,
    relPath
  );
}

/** Create exactly one component, never recursively, never through a symlink. */
async function createComponent(
  absPath: string,
  relPath: string
): Promise<void> {
  try {
    await mkdir(absPath);
  } catch (cause) {
    const code = (cause as { code?: unknown } | null)?.code;
    if (code === "EEXIST") {
      // Someone else won the race. The re-proof below decides whether what
      // landed there is acceptable.
      return;
    }
    throw new CaptureDestinationError(
      "PATH_UNRESOLVED",
      `Failed to create parent directory ${absPath} for ${relPath}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      relPath
    );
  }
}

/**
 * Prove - and where absent, create - the parent chain of a collection-relative
 * write target without following any symlink below the collection root.
 *
 * Replaces `mkdir(dirname(absPath), { recursive: true })` at every capture and
 * note-creation site. `recursive: true` is not equivalent: it treats an existing
 * directory symlink as "already there" and writes through it.
 *
 * The collection ROOT stays exempt, exactly as it is for the walker: it is
 * legitimately a symlink (`/tmp -> /private/tmp`).
 *
 * Like `checkWalkPathVisibility`, this is component-by-component on path
 * strings and therefore not atomic; a component can be replaced by a symlink
 * after it is proven. The post-write `requireActiveCaptureDocument` proof is
 * what makes that residual window non-silent: the file is written, the index
 * refuses it, and the caller reports a failure instead of success.
 *
 * @returns the absolute destination path, proven reachable at the time of the
 *   check.
 * @throws CaptureDestinationError - nothing has been written when it throws.
 */
export async function prepareCaptureDestination(
  collectionPath: string,
  relPath: string
): Promise<string> {
  const normalized = normalizeCollectionDirRelPath(relPath);
  if (normalized === null) {
    throw new CaptureDestinationError(
      "PATH_OUTSIDE_COLLECTION",
      `Refusing to write ${relPath}: the path escapes the collection root.`,
      relPath
    );
  }
  if (normalized === "") {
    throw new CaptureDestinationError(
      "NOT_DIRECTORY",
      `Refusing to write ${relPath}: the path is the collection root, not a file.`,
      relPath
    );
  }

  const segments = normalized.split("/");
  const parents = segments.slice(0, -1);
  let walked = "";
  for (const segment of parents) {
    walked = walked === "" ? segment : `${walked}/${segment}`;
    const absPath = join(collectionPath, ...walked.split("/"));
    const visibility = await checkWalkPathVisibility(collectionPath, walked);
    if (visibility.status === "symlink") {
      throw await classifySymlinkComponent(
        collectionPath,
        visibility.absPath,
        relPath
      );
    }
    if (visibility.status === "error") {
      throw new CaptureDestinationError(
        "PATH_UNRESOLVED",
        `Refusing to write ${relPath}: ${absPath} could not be examined.`,
        relPath
      );
    }
    if (visibility.status === "visible") {
      if (visibility.leaf?.isDirectory()) {
        continue;
      }
      throw new CaptureDestinationError(
        "NOT_DIRECTORY",
        `Refusing to write ${relPath}: ${absPath} exists and is not a directory.`,
        relPath
      );
    }

    await createComponent(absPath, relPath);
    // Re-prove what we just created rather than assuming it: `EEXIST` above is
    // swallowed, and only this decides whether the winner of that race is a
    // real directory.
    const proven = await checkWalkPathVisibility(collectionPath, walked);
    if (proven.status === "symlink") {
      throw await classifySymlinkComponent(
        collectionPath,
        proven.absPath,
        relPath
      );
    }
    if (!(proven.status === "visible" && proven.leaf?.isDirectory())) {
      throw new CaptureDestinationError(
        "PATH_UNRESOLVED",
        `Refusing to write ${relPath}: ${absPath} is not a usable directory after creation.`,
        relPath
      );
    }
  }

  const absPath = join(collectionPath, ...segments);
  const leaf = await checkWalkPathVisibility(collectionPath, normalized);
  if (leaf.status === "symlink") {
    // The leaf counts too: `Bun.Glob.scan({ followSymlinks: false })` emits
    // neither a symlinked directory nor a symlinked regular file, so writing
    // through a symlinked FILE name is just as unindexable as writing under a
    // symlinked directory.
    throw await classifySymlinkComponent(collectionPath, leaf.absPath, relPath);
  }
  if (leaf.status === "error") {
    throw new CaptureDestinationError(
      "PATH_UNRESOLVED",
      `Refusing to write ${relPath}: ${absPath} could not be examined.`,
      relPath
    );
  }
  if (leaf.status === "visible" && leaf.leaf && !leaf.leaf.isFile()) {
    throw new CaptureDestinationError(
      "NOT_DIRECTORY",
      `Refusing to write ${relPath}: ${absPath} exists and is not a regular file.`,
      relPath
    );
  }
  return absPath;
}

/** Outcome of demanding an indexed document for a just-written path. */
export type ActiveCaptureDocument =
  | { ok: true; document: DocumentRow }
  | { ok: false; message: string };

/**
 * The proof a capture/create caller must demand after syncing its own write.
 *
 * `FileSyncResult.status !== "error"` is NOT proof. `skipped` and `unchanged`
 * are ordinary non-error outcomes, and `syncPaths` returns `skipped` for a path
 * it cannot reach that has no indexed document - precisely the case a write
 * through a symlinked parent produces. A caller that accepts it reports a
 * successful capture, hands back a `gno://` URI that resolves to nothing, and
 * the user finds out later.
 */
export async function requireActiveCaptureDocument(
  store: Pick<StorePort, "getDocument">,
  collectionName: string,
  relPath: string
): Promise<ActiveCaptureDocument> {
  const result = await store.getDocument(collectionName, relPath);
  if (!result.ok) {
    return { ok: false, message: result.error.message };
  }
  const document = result.value;
  if (!document) {
    return {
      ok: false,
      message: `File written but not indexed: no document exists for ${relPath}. The path is not reachable to the indexer or is excluded from the collection.`,
    };
  }
  if (!document.active) {
    return {
      ok: false,
      message: `File written but not indexed: the document for ${relPath} is inactive.`,
    };
  }
  return { ok: true, document };
}
