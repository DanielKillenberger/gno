import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WalkConfig } from "../../src/ingestion/types";

import {
  listEligibleDirectChildren,
  listEligibleSubtreeFiles,
  resolveVanishedPathDirectory,
} from "../../src/ingestion/directory-children";
import { FileWalker } from "../../src/ingestion/walker";
import { safeRm } from "../helpers/cleanup";

function walkConfig(root: string, overrides: Partial<WalkConfig> = {}) {
  return {
    root,
    pattern: "**/*",
    include: [],
    additionalDefaultExtensions: [],
    exclude: [],
    maxBytes: 10_000_000,
    ...overrides,
  } satisfies WalkConfig;
}

describe("listEligibleDirectChildren", () => {
  let base = "";
  let root = "";

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "gno-dir-children-"));
    root = join(base, "root");
    await mkdir(root);
  });

  afterEach(async () => {
    await safeRm(base);
  });

  test("returns eligible direct children of the collection root", async () => {
    await writeFile(join(root, "note.md"), "a");
    await writeFile(join(root, "other.md"), "b");
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "nested.md"), "c");

    const outcome = await listEligibleDirectChildren("", walkConfig(root));

    expect(outcome).toEqual({
      status: "present",
      relPaths: ["note.md", "other.md"],
    });
  });

  test("accepts '.' and slash-padded forms as the collection root", async () => {
    await writeFile(join(root, "note.md"), "a");

    for (const dir of [".", "./", ""]) {
      expect(await listEligibleDirectChildren(dir, walkConfig(root))).toEqual({
        status: "present",
        relPaths: ["note.md"],
      });
    }
  });

  test("returns eligible direct children of a nested directory", async () => {
    await mkdir(join(root, "a", "b"), { recursive: true });
    await writeFile(join(root, "a", "top.md"), "a");
    await writeFile(join(root, "a", "b", "deep.md"), "b");
    await writeFile(join(root, "rootlevel.md"), "c");

    expect(await listEligibleDirectChildren("a", walkConfig(root))).toEqual({
      status: "present",
      relPaths: ["a/top.md"],
    });

    expect(await listEligibleDirectChildren("a/b/", walkConfig(root))).toEqual({
      status: "present",
      relPaths: ["a/b/deep.md"],
    });
  });

  test("does not recurse into nested subdirectories", async () => {
    await mkdir(join(root, "deep", "deeper"), { recursive: true });
    await writeFile(join(root, "deep", "deeper", "hidden-away.md"), "a");

    expect(await listEligibleDirectChildren("deep", walkConfig(root))).toEqual({
      status: "present",
      relPaths: [],
    });
  });

  test("applies include, exclude, and pattern rules via matchesWalkPath", async () => {
    await writeFile(join(root, "keep.md"), "a");
    await writeFile(join(root, "skip.txt"), "b");
    await writeFile(join(root, "excluded.md"), "c");

    const outcome = await listEligibleDirectChildren(
      "",
      walkConfig(root, { include: [".md"], exclude: ["excluded.md"] })
    );

    expect(outcome).toEqual({ status: "present", relPaths: ["keep.md"] });
  });

  test("respects a narrowing glob pattern", async () => {
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "in.md"), "a");
    await writeFile(join(root, "out.md"), "b");

    expect(
      await listEligibleDirectChildren(
        "",
        walkConfig(root, { pattern: "docs/**/*" })
      )
    ).toEqual({ status: "present", relPaths: [] });

    expect(
      await listEligibleDirectChildren(
        "docs",
        walkConfig(root, { pattern: "docs/**/*" })
      )
    ).toEqual({ status: "present", relPaths: ["docs/in.md"] });
  });

  test("excludes dotfiles and reserved virtual record paths", async () => {
    await writeFile(join(root, "visible.md"), "a");
    await writeFile(join(root, ".hidden.md"), "b");
    await mkdir(join(root, ".dotdir"));
    await writeFile(join(root, ".dotdir", "inner.md"), "d");
    await mkdir(join(root, ".gno", "records"), { recursive: true });
    await writeFile(join(root, ".gno", "records", "fake.md"), "c");

    expect(await listEligibleDirectChildren("", walkConfig(root))).toEqual({
      status: "present",
      relPaths: ["visible.md"],
    });
    expect(
      await listEligibleDirectChildren(".dotdir", walkConfig(root))
    ).toEqual({ status: "present", relPaths: [] });
    expect(
      await listEligibleDirectChildren(".gno/records", walkConfig(root))
    ).toEqual({ status: "present", relPaths: [] });

    // Parity gate: reconciliation must not surface anything a full collection
    // walk would refuse to index.
    const walked = await new FileWalker().walk(walkConfig(root));
    expect(walked.entries.map((entry) => entry.relPath)).toEqual([
      "visible.md",
    ]);
  });

  test("returns missing for a vanished directory", async () => {
    expect(await listEligibleDirectChildren("gone", walkConfig(root))).toEqual({
      status: "missing",
    });
  });

  test("returns missing when the target path is a file, not a directory", async () => {
    await writeFile(join(root, "file.md"), "a");

    expect(
      await listEligibleDirectChildren("file.md", walkConfig(root))
    ).toEqual({ status: "missing" });
  });

  test("returns missing when the collection root itself is gone", async () => {
    expect(
      await listEligibleDirectChildren(
        "",
        walkConfig(join(base, "no-such-root"))
      )
    ).toEqual({ status: "missing" });
  });

  test("returns error with cause for an unreadable directory", async () => {
    const locked = join(root, "locked");
    await mkdir(locked);
    await writeFile(join(locked, "note.md"), "a");
    await chmod(locked, 0o000);

    try {
      const outcome = await listEligibleDirectChildren(
        "locked",
        walkConfig(root)
      );
      // Running as root defeats permission bits; only assert when it took hold.
      if (outcome.status === "present") {
        return;
      }
      expect(outcome.status).toBe("error");
      const { cause } = outcome as { cause: { code?: string } };
      expect(cause).toBeDefined();
      expect(cause.code).toBe("EACCES");
    } finally {
      await chmod(locked, 0o755);
    }
  });

  test("refuses a directory argument that escapes the collection root", async () => {
    await writeFile(join(base, "outside.md"), "a");

    for (const dir of ["..", "../", "a/../..", "/etc"]) {
      const outcome = await listEligibleDirectChildren(dir, walkConfig(root));
      expect(outcome.status).toBe("error");
      expect(String((outcome as { cause: unknown }).cause)).toContain(
        "escapes the collection root"
      );
    }
  });

  test("reconciles a POSIX-legal drive-shaped directory name", async () => {
    // `a:notes` is a legal directory name on Linux/macOS. Classifying it as an
    // escape would drop its reconciliation entirely.
    if (process.platform === "win32") {
      return;
    }
    await mkdir(join(root, "a:notes"));
    await writeFile(join(root, "a:notes", "note.md"), "a");

    expect(
      await listEligibleDirectChildren("a:notes", walkConfig(root))
    ).toEqual({
      status: "present",
      relPaths: ["a:notes/note.md"],
    });
  });

  test("refuses a symlinked directory that resolves outside the collection root", async () => {
    const outside = join(base, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "far.md"), "a");
    await symlink(outside, join(root, "linkdir"));

    const outcome = await listEligibleDirectChildren(
      "linkdir",
      walkConfig(root)
    );

    expect(outcome.status).toBe("error");
    expect(String((outcome as { cause: unknown }).cause)).toContain(
      "escapes the collection root"
    );
  });

  test("never throws for a bogus glob pattern", async () => {
    await writeFile(join(root, "note.md"), "a");

    const outcome = await listEligibleDirectChildren(
      "",
      walkConfig(root, { pattern: "[" })
    );

    expect(outcome).toEqual({ status: "present", relPaths: [] });
  });

  test("symlink handling matches FileWalker.walk", async () => {
    const outside = join(base, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "far.md"), "x");
    await writeFile(join(root, "real.md"), "a");
    await symlink(join(root, "real.md"), join(root, "link-inside.md"));
    await symlink(join(outside, "far.md"), join(root, "link-outside.md"));
    await symlink(join(base, "nope.md"), join(root, "broken.md"));

    const walked = await new FileWalker().walk(walkConfig(root));
    const walkedRootChildren = walked.entries
      .map((entry) => entry.relPath)
      .filter((relPath) => !relPath.includes("/"))
      .sort();

    const outcome = await listEligibleDirectChildren("", walkConfig(root));

    // FileWalker scans with followSymlinks:false, so no symlink entry is
    // returned - not even one resolving to a regular file inside the root.
    expect(walkedRootChildren).toEqual(["real.md"]);
    expect(outcome).toEqual({ status: "present", relPaths: ["real.md"] });
  });
});

/**
 * The recursive form used for a directory carrying REMOVAL INTENT that turned
 * out to exist again. Same eligibility, same discovery parity, same
 * containment - it only descends.
 */
describe("listEligibleSubtreeFiles", () => {
  let base = "";
  let root = "";

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "gno-dir-subtree-"));
    root = join(base, "root");
    await mkdir(root);
  });

  afterEach(async () => {
    await safeRm(base);
  });

  test("returns eligible files at every depth beneath the directory", async () => {
    await mkdir(join(root, "dir1", "sub", "deeper"), { recursive: true });
    await writeFile(join(root, "dir1", "top.md"), "a");
    await writeFile(join(root, "dir1", "sub", "mid.md"), "b");
    await writeFile(join(root, "dir1", "sub", "deeper", "deep.md"), "c");
    // Outside the enumerated directory: bounded means bounded.
    await writeFile(join(root, "outside.md"), "d");

    expect(await listEligibleSubtreeFiles("dir1", walkConfig(root))).toEqual({
      status: "present",
      relPaths: ["dir1/sub/deeper/deep.md", "dir1/sub/mid.md", "dir1/top.md"],
    });
  });

  test("keeps walker discovery parity while descending", async () => {
    await mkdir(join(root, "dir1", ".hidden"), { recursive: true });
    await mkdir(join(root, "dir1", "sub"), { recursive: true });
    await writeFile(join(root, "dir1", ".hidden", "secret.md"), "a");
    await writeFile(join(root, "dir1", "sub", ".dotfile.md"), "b");
    await writeFile(join(root, "dir1", "sub", "kept.md"), "c");
    await writeFile(join(root, "escape.md"), "d");
    // A symlinked directory is neither descended into nor listed, which is both
    // walker parity and what makes the recursion loop-free.
    await symlink(root, join(root, "dir1", "loop"), "dir");

    expect(await listEligibleSubtreeFiles("dir1", walkConfig(root))).toEqual({
      status: "present",
      relPaths: ["dir1/sub/kept.md"],
    });
  });

  test("reports a genuinely absent directory as missing", async () => {
    expect(await listEligibleSubtreeFiles("gone", walkConfig(root))).toEqual({
      status: "missing",
    });
  });

  test("applies the collection's eligibility rules to nested candidates", async () => {
    await mkdir(join(root, "dir1", "sub"), { recursive: true });
    await writeFile(join(root, "dir1", "sub", "kept.md"), "a");
    await writeFile(join(root, "dir1", "sub", "image.png"), "b");

    expect(
      await listEligibleSubtreeFiles(
        "dir1",
        walkConfig(root, { pattern: "**/*.md" })
      )
    ).toEqual({ status: "present", relPaths: ["dir1/sub/kept.md"] });
  });
});

/**
 * The collection root is the CEILING of the ancestor walk, which is what keeps
 * a deletion from escalating above the collection. It is not a claim that the
 * root still exists - and conflating the two left every document under a
 * deleted collection root active forever.
 */
describe("resolveVanishedPathDirectory collection-root handling", () => {
  let base = "";
  let root = "";

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "gno-vanished-root-"));
    root = join(base, "root");
    await mkdir(root);
  });

  afterEach(async () => {
    await chmod(base, 0o700).catch(() => undefined);
    await safeRm(base);
  });

  test("a surviving root reconciles only its own direct children", async () => {
    const outcome = await resolveVanishedPathDirectory("gone.md", root);

    // Nothing above the file went anywhere, so there is no subtree to widen to.
    expect(outcome).toEqual({
      status: "removed",
      directory: "",
      directoryRemoved: false,
    });
  });

  test("a removed ancestor is reported as removed, not as a surviving parent", async () => {
    const outcome = await resolveVanishedPathDirectory("dir1/sub/c.md", root);

    expect(outcome).toEqual({
      status: "removed",
      directory: "dir1",
      directoryRemoved: true,
    });
  });

  test("widens a vanished child of a drive-shaped POSIX directory name", async () => {
    // Pre-fix this path was refused as an escape, so a delete under `a:notes`
    // never widened and its siblings stayed active.
    if (process.platform === "win32") {
      return;
    }
    await mkdir(join(root, "a:notes"));

    const outcome = await resolveVanishedPathDirectory("a:notes/gone.md", root);

    expect(outcome).toEqual({
      status: "removed",
      directory: "a:notes",
      directoryRemoved: false,
    });
  });

  test("an ABSENT collection root marks the root itself removed", async () => {
    await safeRm(root);

    const outcome = await resolveVanishedPathDirectory("dir1/a.md", root);

    // The whole collection directory went, so the area to reconcile is the
    // root AND everything indexed beneath it - not `dir1` alone, and not
    // "the root survived" as before.
    expect(outcome).toEqual({
      status: "removed",
      directory: "",
      directoryRemoved: true,
    });
  });

  test("an absent root is still the root for a root-level file", async () => {
    await safeRm(root);

    const outcome = await resolveVanishedPathDirectory("top.md", root);

    expect(outcome).toEqual({
      status: "removed",
      directory: "",
      directoryRemoved: true,
    });
  });

  test.skipIf(process.getuid?.() === 0)(
    "an UNSTATTABLE root fails closed instead of claiming a removal",
    async () => {
      // The root is unreadable, not gone: `stat` fails with EACCES rather than
      // ENOENT. A transient/permission failure must never be read as absence,
      // because absence is what deactivates documents.
      await chmod(base, 0o000);

      const outcome = await resolveVanishedPathDirectory("dir1/a.md", root);

      expect(outcome.status).toBe("error");
      expect((outcome as { cause?: { code?: string } }).cause?.code).toBe(
        "EACCES"
      );
    }
  );
});
