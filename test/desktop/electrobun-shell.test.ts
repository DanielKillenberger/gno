import { describe, expect, test } from "bun:test";

describe("electrobun shell scaffold", () => {
  test("shell package and entrypoint exist", async () => {
    expect(
      await Bun.file("desktop/electrobun-shell/package.json").exists()
    ).toBe(true);
    expect(
      await Bun.file("desktop/electrobun-shell/src/bun/index.ts").exists()
    ).toBe(true);
    expect(
      await Bun.file(
        "desktop/electrobun-shell/scripts/stage-gno-runtime.ts"
      ).exists()
    ).toBe(true);
    expect(
      await Bun.file(
        "desktop/electrobun-shell/scripts/verify-packaged-runtime.ts"
      ).exists()
    ).toBe(true);
  });

  test("README records shell boundary and open-file strategy", async () => {
    const readme = await Bun.file("desktop/electrobun-shell/README.md").text();
    expect(readme).toContain("open-file");
    expect(readme).toContain("singleton");
    expect(readme).toContain("Tabs stay app-level GNO workspace state.");
    expect(readme).toContain("GNO_ELECTROBUN_SELFTEST");
  });

  test("plist fragment records markdown/plaintext association strategy", async () => {
    const plist = await Bun.file(
      "desktop/electrobun-shell/macos/Info.plist.fragment.plist"
    ).text();
    expect(plist).toContain("CFBundleDocumentTypes");
    expect(plist).toContain("net.daringfireball.markdown");
    expect(plist).toContain("public.plain-text");
  });

  test("shell config stages packaged runtime before build", async () => {
    const config = await Bun.file(
      "desktop/electrobun-shell/electrobun.config.ts"
    ).text();
    expect(config).toContain('preBuild: "./scripts/stage-gno-runtime.ts"');
    expect(config).toContain('".generated/gno-runtime"');
  });

  test("signed macOS launch gate initializes a hermetic packaged profile", async () => {
    const workflow = await Bun.file(".github/workflows/publish.yml").text();
    expect(workflow).toContain(
      'PACKAGED_GNO="$APP_PATH/Contents/Resources/app/gno-runtime/src/index.ts"'
    );
    expect(workflow).toContain(
      '"$PACKAGED_BUN" "$PACKAGED_GNO" init "$NOTES_DIR" --name notes'
    );
    expect(workflow).toContain('GNO_ELECTROBUN_SELFTEST=1 "$APP_EXECUTABLE" &');
  });
});
