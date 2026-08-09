import { describe, expect, test } from "bun:test";

import { findPager } from "../../src/cli/pager";

describe("findPager", () => {
  test("uses the configured pager on every platform", () => {
    expect(findPager({ PAGER: "less -FRX" }, "win32")).toEqual({
      kind: "external",
      command: ["less", "-FRX"],
    });
  });

  test("uses the in-process pager by default on Windows", () => {
    expect(findPager({}, "win32")).toEqual({ kind: "internal" });
  });

  test("uses less with color support by default on Unix", () => {
    expect(findPager({}, "darwin")).toEqual({
      kind: "external",
      command: ["less", "-R"],
    });
  });
});
