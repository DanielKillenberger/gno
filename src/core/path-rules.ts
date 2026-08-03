/**
 * Shared path-rule semantics for profile validation, setup preflight, and
 * ingestion. Paths use repository-relative POSIX form at this boundary.
 *
 * @module src/core/path-rules
 */

const GLOB_META_PATTERN = /[*?[\]{}]/;
const SECRET_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^credentials?(?:\.|$)/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i,
  /^secrets?(?:\.|$)/i,
  /\.(?:key|pem|p12|pfx)$/i,
];

export function hasLikelySecretPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

export function hasGlobMeta(pattern: string): boolean {
  return GLOB_META_PATTERN.test(pattern);
}

const WINDOWS_DRIVE_PREFIX_PATTERN = /^[a-z]:/i;

/**
 * Which platform's path grammar to judge a relative directory path against.
 * Injected rather than read from `process.platform` at the use site so the
 * Windows-only rules are exercised deterministically on POSIX CI.
 */
export type CollectionPathSemantics = "windows" | "posix";

function currentPathSemantics(): CollectionPathSemantics {
  return process.platform === "win32" ? "windows" : "posix";
}

/**
 * Normalize a collection-relative DIRECTORY path to the canonical POSIX form
 * used as a directory key: no leading or trailing separator, no `.` segments,
 * and the collection root as the empty string.
 *
 * Returns `null` when the path cannot be a directory inside the collection
 * root - an absolute path, a UNC prefix, a Windows drive prefix (under Windows
 * semantics), or any `..` segment. Callers must treat `null` as a refusal,
 * never as the root.
 *
 * The drive-letter rule is platform-conditional because it is not a universal
 * escape: `a:notes` and `c:stuff` are ordinary legal directory names on Linux
 * and macOS. Refusing them there is silent data loss, not safety - the watcher
 * drops the reconciliation outright and the store refuses the vanished-path
 * widening, so unreported siblings stay active and searchable forever. Absolute
 * paths, UNC prefixes (`\\server\share` normalizes to a leading `/`), and `..`
 * segments escape under BOTH grammars and stay refused unconditionally.
 *
 * The backslash-to-slash rewrite above the platform check is deliberately NOT
 * conditional, even though `weird\name` is a legal POSIX filename and gets
 * split into two segments here. It is a load-bearing part of this boundary's
 * contract: callers may hand it a Windows-form relative path on any platform
 * (the watcher rewrites separators before it ever reaches here, and
 * `test/store/active-direct-children.test.ts` pins `a\b` resolving to `a/b` on
 * every platform). Backslash-bearing POSIX directory names are therefore
 * already flattened upstream of this function and cannot be recovered by
 * changing it alone; the asymmetry with the drive rule is intentional, and the
 * harm profiles differ - over-segmenting an exotic name still reconciles
 * SOMETHING, whereas a `null` refusal reconciles nothing at all.
 */
export function normalizeCollectionDirRelPath(
  dirRelPath: string,
  semantics: CollectionPathSemantics = currentPathSemantics()
): string | null {
  const normalized = dirRelPath.replaceAll("\\", "/");
  if (normalized.startsWith("/")) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return null;
    }
    segments.push(segment);
  }
  const canonical = segments.join("/");

  // The drive check runs on the CANONICAL form, after harmless `.` segments
  // are gone. Testing the raw input instead let `./C:/foo` walk straight past
  // it and come back as the accepted `C:/foo`: the leading segment was `.`, so
  // the drive prefix was not at position 0 yet, and canonicalization then put
  // it there. Only the FIRST segment can carry a drive escape, which is exactly
  // what this form exposes.
  if (semantics === "windows" && WINDOWS_DRIVE_PREFIX_PATTERN.test(canonical)) {
    return null;
  }
  return canonical;
}

/**
 * Bare values preserve historical component/prefix semantics. Values with
 * glob metacharacters match the complete normalized relative path.
 */
export function matchesCollectionExclusion(
  relPath: string,
  excludes: readonly string[]
): boolean {
  const normalizedPath = relPath.replaceAll("\\", "/");
  const parts = normalizedPath.split("/");

  for (const rawPattern of excludes) {
    const pattern = rawPattern.replaceAll("\\", "/");
    if (hasGlobMeta(pattern)) {
      if (new Bun.Glob(pattern).match(normalizedPath)) return true;
      continue;
    }
    if (
      parts.includes(pattern) ||
      normalizedPath === pattern ||
      normalizedPath.startsWith(`${pattern}/`)
    ) {
      return true;
    }
  }
  return false;
}
