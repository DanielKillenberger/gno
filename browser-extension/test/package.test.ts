import { afterEach, describe, expect, test } from "bun:test";
// node:fs/promises supplies temporary structure, cleanup, and the node_modules symlink.
import { mkdtemp, symlink } from "node:fs/promises";
// node:os exposes the platform temporary directory.
import { tmpdir } from "node:os";
import { join } from "node:path";

import { safeRm } from "../../test/helpers/cleanup";
import { readArchiveEntries, sha256Hex } from "../archive";
import { packageClipper } from "../package";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await safeRm(tempRoot);
    tempRoot = null;
  }
});

const copyPackagingInputs = async (
  sourceRoot: string,
  destRoot: string
): Promise<void> => {
  const glob = new Bun.Glob("**/*");
  for await (const rel of glob.scan({
    cwd: sourceRoot,
    onlyFiles: true,
  })) {
    if (
      rel.startsWith("dist/") ||
      rel.startsWith("artifacts/") ||
      rel.startsWith("test/") ||
      rel.includes("node_modules/")
    ) {
      continue;
    }
    await Bun.write(join(destRoot, rel), Bun.file(join(sourceRoot, rel)));
  }
};

describe("browser clipper package", () => {
  test("emits non-empty version-matched unpacked, archive, and checksum outputs", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "gno-clipper-package-test-"));
    const repoRoot = join(import.meta.dir, "..", "..");
    const packRoot = join(tempRoot, "pack");
    const extRoot = join(packRoot, "browser-extension");
    // Snapshot sources into the temp tree so Bun.build does not race other
    // full-suite files that import the live gateway.ts / preview graph.
    await Bun.write(
      join(packRoot, "package.json"),
      Bun.file(join(repoRoot, "package.json"))
    );
    await symlink(
      join(repoRoot, "node_modules"),
      join(packRoot, "node_modules")
    );
    await copyPackagingInputs(join(repoRoot, "browser-extension"), extRoot);
    const result = await packageClipper({
      rootDir: extRoot,
      artifactsDir: join(tempRoot, "artifacts"),
      distDir: join(tempRoot, "dist"),
    });
    const packageManifest = (await Bun.file(
      join(import.meta.dir, "..", "..", "package.json")
    ).json()) as { version: string };
    const extensionManifest = (await Bun.file(
      join(result.distDir, "manifest.json")
    ).json()) as { version: string };
    const archive = new Uint8Array(
      await Bun.file(result.archivePath).arrayBuffer()
    );
    const checksum = await Bun.file(result.checksumPath).text();

    expect(extensionManifest.version).toBe(packageManifest.version);
    expect(result.archiveName).toBe(
      `gno-browser-clipper-v${packageManifest.version}.zip`
    );
    expect(archive.byteLength).toBeGreaterThan(1_000);
    expect(checksum).toBe(`${sha256Hex(archive)}  ${result.archiveName}\n`);
    expect(readArchiveEntries(archive).map(({ path }) => path)).toContain(
      "manifest.json"
    );
    expect(Bun.file(join(result.distDir, "PRIVACY.md")).size).toBeGreaterThan(
      1_000
    );
  });
});
