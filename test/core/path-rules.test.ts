import { describe, expect, test } from "bun:test";

import type { CollectionPathSemantics } from "../../src/core/path-rules";

import {
  exclusionCoversSubtree,
  matchesCollectionExclusion,
  normalizeCollectionDirRelPath,
} from "../../src/core/path-rules";

const BOTH: CollectionPathSemantics[] = ["posix", "windows"];

describe("normalizeCollectionDirRelPath", () => {
  test("canonicalizes ordinary relative directory paths under both grammars", () => {
    for (const semantics of BOTH) {
      expect(normalizeCollectionDirRelPath("a/b", semantics)).toBe("a/b");
      expect(normalizeCollectionDirRelPath("./a/b/", semantics)).toBe("a/b");
      expect(normalizeCollectionDirRelPath("a\\b", semantics)).toBe("a/b");
      expect(normalizeCollectionDirRelPath(".", semantics)).toBe("");
      expect(normalizeCollectionDirRelPath("", semantics)).toBe("");
    }
  });

  test("accepts POSIX-legal drive-shaped directory names under posix semantics", () => {
    expect(normalizeCollectionDirRelPath("a:notes", "posix")).toBe("a:notes");
    expect(normalizeCollectionDirRelPath("c:stuff/deep", "posix")).toBe(
      "c:stuff/deep"
    );
    expect(normalizeCollectionDirRelPath("a:", "posix")).toBe("a:");
    expect(normalizeCollectionDirRelPath("./C:/foo", "posix")).toBe("C:/foo");
  });

  test("refuses Windows drive prefixes under windows semantics", () => {
    expect(normalizeCollectionDirRelPath("C:/foo", "windows")).toBeNull();
    expect(normalizeCollectionDirRelPath("C:\\foo", "windows")).toBeNull();
    expect(normalizeCollectionDirRelPath("c:stuff", "windows")).toBeNull();
    expect(normalizeCollectionDirRelPath("a:notes", "windows")).toBeNull();
  });

  test("refuses a drive prefix hidden behind leading dot segments", () => {
    // The drive check must run on the CANONICAL form. Testing the raw input
    // let a leading `.` segment push the drive letter off position 0, and
    // canonicalization then handed the caller back the accepted `C:/foo` - the
    // exact escape the windows rule exists to refuse, reachable by prefixing
    // two characters.
    expect(normalizeCollectionDirRelPath("./C:/foo", "windows")).toBeNull();
    expect(normalizeCollectionDirRelPath(".\\C:\\foo", "windows")).toBeNull();
    expect(normalizeCollectionDirRelPath("././c:stuff", "windows")).toBeNull();
    expect(normalizeCollectionDirRelPath("./a:", "windows")).toBeNull();
    // Only the FIRST segment can carry the escape: a drive-shaped name deeper
    // in the path is an ordinary directory name and stays accepted, as before.
    expect(normalizeCollectionDirRelPath("./notes/C:/foo", "windows")).toBe(
      "notes/C:/foo"
    );
  });

  test("refuses absolute paths, UNC prefixes, and traversal under both grammars", () => {
    for (const semantics of BOTH) {
      expect(normalizeCollectionDirRelPath("/etc", semantics)).toBeNull();
      expect(normalizeCollectionDirRelPath("/", semantics)).toBeNull();
      expect(
        normalizeCollectionDirRelPath("\\\\server\\share", semantics)
      ).toBeNull();
      expect(
        normalizeCollectionDirRelPath("//server/share", semantics)
      ).toBeNull();
      expect(normalizeCollectionDirRelPath("..", semantics)).toBeNull();
      expect(normalizeCollectionDirRelPath("../", semantics)).toBeNull();
      expect(normalizeCollectionDirRelPath("a/../..", semantics)).toBeNull();
      expect(normalizeCollectionDirRelPath("a/..\\b", semantics)).toBeNull();
    }
  });

  test("defaults to the running platform's grammar when semantics are omitted", () => {
    const expected =
      process.platform === "win32"
        ? normalizeCollectionDirRelPath("a:notes", "windows")
        : normalizeCollectionDirRelPath("a:notes", "posix");

    expect(normalizeCollectionDirRelPath("a:notes")).toBe(expected);
  });
});

/**
 * `exclusionCoversSubtree` is the DIRECTORY-level question, and it is
 * deliberately narrower than the file-level `matchesCollectionExclusion`.
 * Pruning a directory on the file-level answer is stricter than the walk: with
 * `exclude: ["*.md"]` the walker still indexes `foo.md/child.txt`, so a pruned
 * `foo.md` makes a removed subtree unqueryable and strands `child.txt` active.
 *
 * The whole function is new at 538e3047, so every case here is discriminating
 * by construction (it does not compile against the base). What each case pins
 * is which SIDE of the rule a pattern lands on.
 */
describe("exclusionCoversSubtree", () => {
  test("covers the subtree for bare component/prefix patterns", () => {
    // Bare patterns match as a path COMPONENT or as a `pattern/` prefix, and
    // both reach every descendant - so pruning stays exactly as strict as it
    // was for the ordinary excluded trees, and the amplification bound holds.
    for (const dir of ["node_modules", "a/node_modules", "node_modules/pkg"]) {
      expect(matchesCollectionExclusion(dir, ["node_modules"])).toBe(true);
      expect(exclusionCoversSubtree(dir, ["node_modules"])).toBe(true);
    }
    expect(exclusionCoversSubtree("drafts", ["drafts"])).toBe(true);
    expect(exclusionCoversSubtree("archive/old", ["archive"])).toBe(true);
  });

  test("does NOT cover the subtree for a glob matching only the directory name", () => {
    // The finding: `*.md` matches the directory `foo.md` but says nothing about
    // `foo.md/child.txt`, which the walker still indexes.
    expect(matchesCollectionExclusion("foo.md", ["*.md"])).toBe(true);
    expect(exclusionCoversSubtree("foo.md", ["*.md"])).toBe(false);
    expect(matchesCollectionExclusion("logs.log", ["*.log"])).toBe(true);
    expect(exclusionCoversSubtree("logs.log", ["*.log"])).toBe(false);
    // A single `*` matches one segment only, so descendants stay walkable.
    expect(exclusionCoversSubtree("anything", ["*"])).toBe(false);
  });

  test("covers the subtree for a glob that matches at every depth", () => {
    // Asked at two depths: one level is not enough to tell `dir/*` (which
    // leaves `dir/a/b.txt` walkable) from a doubled-star pattern.
    expect(exclusionCoversSubtree("anything", ["**"])).toBe(true);
    expect(exclusionCoversSubtree("a/b", ["**"])).toBe(true);
  });

  test("ignores patterns that do not match the directory at all", () => {
    expect(exclusionCoversSubtree("notes", ["node_modules"])).toBe(false);
    expect(exclusionCoversSubtree("notes", [])).toBe(false);
    // The collection root is never pruned.
    expect(exclusionCoversSubtree("", ["**"])).toBe(false);
  });

  test("takes the covering pattern when several exclusions match", () => {
    // `*.md` alone would not cover it, but `foo.md` (bare) does, and one
    // covering pattern is enough.
    expect(exclusionCoversSubtree("foo.md", ["*.md", "foo.md"])).toBe(true);
    expect(exclusionCoversSubtree("foo.md", ["*.md", "other"])).toBe(false);
  });
});
