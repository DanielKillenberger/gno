import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE = join(import.meta.dir, "fixtures", "spa-compile-probe.ts");
const CROSS_TARGETS = ["bun-windows-x64", "bun-darwin-x64"] as const;

const compileProbe = (
  outfile: string,
  extraArgs: string[] = []
): ReturnType<typeof Bun.spawnSync> =>
  Bun.spawnSync({
    cmd: [
      "bun",
      "build",
      "--compile",
      "--splitting",
      ...extraArgs,
      PROBE,
      "--outfile",
      outfile,
    ],
    cwd: join(import.meta.dir, "../.."),
    stderr: "pipe",
    stdout: "pipe",
  });

test("compiled production SPA source serves the mount entry without bunfs Bun.build", async () => {
  const root = await mkdtemp(join(tmpdir(), "gno-spa-compile-"));
  const outfile = join(root, "spa-compile-probe");
  try {
    const compiled = compileProbe(outfile);
    expect(compiled.exitCode).toBe(0);
    const ran = Bun.spawnSync({
      cmd: [outfile],
      cwd: join(import.meta.dir, "../.."),
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = ran.stdout.toString();
    const stderr = ran.stderr.toString();
    expect(ran.exitCode).toBe(0);
    expect(stderr).not.toContain("failed to open root directory");
    expect(stderr).not.toContain("/$bunfs/root");
    const report = JSON.parse(stdout) as {
      assetStatus: Record<string, number>;
      bundleIndex: string;
      entryHasMount: boolean;
      firstJsPath: string;
      htmlHasRoot: boolean;
      standalone: boolean;
    };
    expect(report.standalone).toBe(true);
    expect(report.bundleIndex).toContain("/$bunfs/");
    expect(report.htmlHasRoot).toBe(true);
    expect(report.entryHasMount).toBe(true);
    expect(
      Object.values(report.assetStatus).every((status) => status === 200)
    ).toBe(true);

    for (const target of CROSS_TARGETS) {
      const crossOut = join(root, `spa-compile-probe-${target}`);
      const cross = compileProbe(crossOut, ["--target", target]);
      expect(cross.exitCode).toBe(0);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}, 180_000);
