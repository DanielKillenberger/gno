import { describe, expect, test } from "bun:test";

import type { CollectionPathSemantics } from "../../src/core/path-rules";

import { normalizeCollectionDirRelPath } from "../../src/core/path-rules";

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
