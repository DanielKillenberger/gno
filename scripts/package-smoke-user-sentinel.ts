/** Read-only proof that package smoke leaves real GNO state untouched. */

// node:fs/promises supplies directory stat metadata; Bun has no equivalent.
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getPlatformPaths, resolveDirs } from "../src/app/constants";

interface FileSentinel {
  relativePath: string;
  size: number;
  mode: number;
  mtimeMs: number;
  sha256: string;
}

interface RootSentinel {
  kind: "config" | "data";
  exists: boolean;
  count: number;
  bytes: number;
  files: FileSentinel[];
}

export interface UserGnoSentinel {
  roots: Record<string, RootSentinel>;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function isRelevantDataFile(relativePath: string): boolean {
  return (
    /^index-[^/]+\.sqlite(?:-wal|-shm)?$/u.test(relativePath) ||
    relativePath === "gno.db" ||
    relativePath.startsWith("setup-receipts/") ||
    relativePath.startsWith("setup-semantic/")
  );
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    hasher.update(value);
  }
  return hasher.digest("hex");
}

async function snapshotFile(
  root: string,
  relativePath: string
): Promise<FileSentinel> {
  const path = join(root, relativePath);
  const before = await lstat(path);
  const sha256 = await sha256File(path);
  const after = await lstat(path);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  ) {
    throw new Error(
      "Package smoke user-state sentinel changed during read-only capture"
    );
  }
  return {
    relativePath,
    size: after.size,
    mode: after.mode,
    mtimeMs: after.mtimeMs,
    sha256,
  };
}

async function snapshotRoot(
  root: string,
  kind: "config" | "data"
): Promise<RootSentinel> {
  if (!(await pathExists(root))) {
    return { kind, exists: false, count: 0, bytes: 0, files: [] };
  }
  const glob = new Bun.Glob("**/*");
  const relativePaths = [
    ...(await Array.fromAsync(glob.scan({ cwd: root, onlyFiles: true }))),
  ]
    .filter((path) => kind === "config" || isRelevantDataFile(path))
    .sort();
  const files: FileSentinel[] = [];
  for (const relativePath of relativePaths) {
    files.push(await snapshotFile(root, relativePath));
  }
  return {
    kind,
    exists: true,
    count: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0),
    files,
  };
}

function realUserRoots(): Array<{ path: string; kind: "config" | "data" }> {
  const platform = getPlatformPaths();
  const configured = resolveDirs();
  const roots = [
    { path: platform.config, kind: "config" as const },
    { path: platform.data, kind: "data" as const },
    { path: configured.config, kind: "config" as const },
    { path: configured.data, kind: "data" as const },
  ];
  const deduped = new Map<string, { path: string; kind: "config" | "data" }>();
  for (const root of roots) {
    const path = resolve(root.path);
    deduped.set(`${root.kind}:${path}`, { ...root, path });
  }
  return [...deduped.values()];
}

/** Capture content hashes plus size/mode/mtime/count without creating paths. */
export async function snapshotUserGnoState(): Promise<UserGnoSentinel> {
  const roots: Record<string, RootSentinel> = {};
  for (const root of realUserRoots()) {
    roots[`${root.kind}:${root.path}`] = await snapshotRoot(
      root.path,
      root.kind
    );
  }
  return { roots };
}

export function assertUserGnoStateUnchanged(
  before: UserGnoSentinel,
  after: UserGnoSentinel
): void {
  if (!Bun.deepEquals(before, after, true)) {
    throw new Error(
      "Package smoke isolation violation: real GNO config/data DB or receipt state changed"
    );
  }
}

/**
 * Diagnostics only — renders a PRIVACY-SAFE before/after sentinel summary for
 * durable review artifacts.
 *
 * The full in-memory snapshots (including per-file SHA-256) are still captured
 * and still compared by `assertUserGnoStateUnchanged`; only what gets *written
 * to a durable artifact* is narrowed here. Deliberately never emitted:
 *
 *   - absolute paths (they carry the real user's home directory),
 *   - any content-derived hash: for a credential-bearing config file that hash
 *     is a persistent verifier/fingerprint of the secret, and it is not needed
 *     to prove state is unchanged,
 *   - filenames, sizes, modes or timestamps of files under the CONFIG root,
 *     which is the credential-bearing location.
 *
 * What remains is sufficient to prove the isolation claim: per-root kind,
 * existence, file count, byte total, and the actual before/after equality
 * result. For the data root — product-generated index filenames, no credential
 * risk — per-file name and size are kept as the "non-sensitive database/stat
 * evidence" the gate asks for.
 */
export function formatUserGnoSentinelSafeDetail(
  before: UserGnoSentinel,
  after: UserGnoSentinel
): string {
  const lines: string[] = [
    "[gno-sentinel] privacy-safe before/after summary",
    "[gno-sentinel]   (absolute paths, content hashes, and all config-root file",
    "[gno-sentinel]    names/sizes/modes/mtimes are intentionally NOT recorded)",
  ];
  for (const [key, beforeRoot] of Object.entries(before.roots)) {
    const afterRoot = after.roots[key];
    const kind = beforeRoot.kind;
    const unchanged =
      afterRoot !== undefined && Bun.deepEquals(beforeRoot, afterRoot, true);
    lines.push(
      `[gno-sentinel]   root <${kind}-root> exists=${beforeRoot.exists} ` +
        `count(before/after)=${beforeRoot.count}/${afterRoot?.count ?? "n/a"} ` +
        `bytes(before/after)=${beforeRoot.bytes}/${afterRoot?.bytes ?? "n/a"} ` +
        `unchanged=${unchanged}`
    );
    if (kind === "config") {
      lines.push(
        "[gno-sentinel]     <config root contents redacted — credential-bearing;" +
          " equality proven by the full-snapshot assertion above>"
      );
      continue;
    }
    for (const file of beforeRoot.files) {
      const match = afterRoot?.files.find(
        (f) => f.relativePath === file.relativePath
      );
      lines.push(
        `[gno-sentinel]     ${file.relativePath} size(before/after)=${file.size}/${match?.size ?? "n/a"}`
      );
    }
  }
  return lines.join("\n");
}

export function formatUserGnoSentinelProof(sentinel: UserGnoSentinel): string {
  const roots = Object.values(sentinel.roots);
  const files = roots.reduce((total, root) => total + root.count, 0);
  const bytes = roots.reduce((total, root) => total + root.bytes, 0);
  return `Real GNO sentinel passed: ${files} files / ${bytes} bytes SHA-256/stat/count unchanged`;
}

export async function verifyUserGnoStateUnchanged(
  before: UserGnoSentinel
): Promise<string> {
  const after = await snapshotUserGnoState();
  assertUserGnoStateUnchanged(before, after);
  return formatUserGnoSentinelProof(after);
}

/**
 * Same verification, additionally returning the exact `after` snapshot that was
 * compared — so a caller can log the real before/after values instead of taking
 * a second, potentially different snapshot purely for reporting. The assertion
 * is identical to `verifyUserGnoStateUnchanged`.
 */
export async function verifyUserGnoStateUnchangedDetailed(
  before: UserGnoSentinel
): Promise<{ proof: string; after: UserGnoSentinel }> {
  const after = await snapshotUserGnoState();
  assertUserGnoStateUnchanged(before, after);
  return { proof: formatUserGnoSentinelProof(after), after };
}
