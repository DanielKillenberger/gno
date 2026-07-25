import { describe, expect, test } from "bun:test";

import { normalizeRecordDate } from "../../src/ingestion/record-container";

const normalizeInTimeZone = async (timeZone: string): Promise<string> => {
  const script = `
    import { normalizeRecordDate } from "./src/ingestion/record-container.ts";
    console.log(JSON.stringify([
      normalizeRecordDate("2026-01-01T10:00:00.123"),
      normalizeRecordDate("01/02/2026"),
    ]));
  `;
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: timeZone },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`timezone subprocess failed: ${stderr}`);
  }
  return stdout.trim();
};

describe("logical record date normalization", () => {
  test("accepts only deterministic date representations", () => {
    expect(normalizeRecordDate("2026-02-29")).toBeUndefined();
    expect(normalizeRecordDate("2026-02-28")).toBe("2026-02-28");
    expect(normalizeRecordDate("2026-01-01T10:00:00.123")).toBe(
      "2026-01-01T10:00:00.123"
    );
    expect(normalizeRecordDate("2026-01-01T10:00:00+02:00")).toBe(
      "2026-01-01T08:00:00.000Z"
    );
    expect(normalizeRecordDate("01/02/2026")).toBeUndefined();
  });

  test("is host-timezone invariant for floating and rejected locale dates", async () => {
    const utc = await normalizeInTimeZone("UTC");
    const newYork = await normalizeInTimeZone("America/New_York");
    expect(utc).toBe(newYork);
    expect(JSON.parse(utc)).toEqual(["2026-01-01T10:00:00.123", null]);
  });
});
