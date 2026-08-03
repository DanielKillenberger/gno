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

/**
 * Normalize a collection-relative DIRECTORY path to the canonical POSIX form
 * used as a directory key: no leading or trailing separator, no `.` segments,
 * and the collection root as the empty string.
 *
 * Returns `null` when the path cannot be a directory inside the collection
 * root - an absolute path, a Windows drive/UNC prefix, or any `..` segment.
 * Callers must treat `null` as a refusal, never as the root.
 */
export function normalizeCollectionDirRelPath(
  dirRelPath: string
): string | null {
  const normalized = dirRelPath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) {
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
  return segments.join("/");
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
