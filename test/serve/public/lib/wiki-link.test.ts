import { describe, expect, test } from "bun:test";

import { getActiveWikiLinkQuery } from "../../../../src/serve/public/lib/wiki-link";

describe("wiki link query detection", () => {
  test("detects active query after [[", () => {
    expect(getActiveWikiLinkQuery("hello [[Auth Flo", 17)).toEqual({
      query: "Auth Flo",
      start: 6,
      end: 17,
    });
  });

  test("returns null when cursor is outside wiki link", () => {
    expect(getActiveWikiLinkQuery("hello world", 11)).toBeNull();
  });

  test("returns null when link is already closed", () => {
    expect(getActiveWikiLinkQuery("[[Auth]] next", 8)).toBeNull();
  });
});
