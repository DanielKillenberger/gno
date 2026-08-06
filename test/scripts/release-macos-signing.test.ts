import { describe, expect, test } from "bun:test";

import {
  buildBundleSignArgv,
  buildNestedSignArgv,
  bundledBunPath,
  classifyNestedSigningTargets,
  hasHardenedRuntimeFlag,
  hasJitEntitlement,
  isPotentialSigningPath,
  readEntitlementBoolean,
  type SigningCandidate,
} from "../../desktop/electrobun-shell/scripts/release-macos";

const APP = "/tmp/release/GNO Desktop Beta-dev.app";
const JIT_KEY = "com.apple.security.cs.allow-jit";
const VENDORED_BUN = `${APP}/Contents/Resources/app/gno-runtime/node_modules/@oven/bun-darwin-aarch64/bin/bun`;

function machO(path: string): SigningCandidate {
  return { path, isMachO: true };
}

/** Mirrors the 23 Mach-O files enumerated from the shipped 1.29.6 bundle. */
function bundleCandidates(): SigningCandidate[] {
  const extensionMatched = [
    `${APP}/Contents/MacOS/libNativeWrapper.dylib`,
    `${APP}/Contents/MacOS/libbun.dylib`,
    ...Array.from(
      { length: 12 },
      (_unused, index) =>
        `${APP}/Contents/Resources/app/gno-runtime/node_modules/pkg-${index}/build/native.node`
    ),
    ...Array.from(
      { length: 3 },
      (_unused, index) =>
        `${APP}/Contents/Resources/app/gno-runtime/lib/support-${index}.dylib`
    ),
    `${APP}/Contents/Resources/app/gno-runtime/lib/onnxruntime.so`,
  ].map(machO);

  const executables = [
    `${APP}/Contents/MacOS/bun`,
    `${APP}/Contents/MacOS/launcher`,
    `${APP}/Contents/MacOS/bspatch`,
    `${APP}/Contents/MacOS/zig-zstd`,
  ].map(machO);

  const nonMachO = [
    { path: `${APP}/Contents/Info.plist`, isMachO: false },
    { path: `${APP}/Contents/MacOS`, isMachO: false },
    { path: `${APP}/Contents/Resources/app/index.html`, isMachO: false },
  ];

  return [
    ...extensionMatched,
    ...executables,
    machO(VENDORED_BUN),
    ...nonMachO,
  ];
}

function entitlementsPlist(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}

describe("classifyNestedSigningTargets", () => {
  test("selects the four Contents/MacOS extensionless executables", () => {
    const targets = classifyNestedSigningTargets(APP, bundleCandidates());

    expect([...targets.machOExecutables].sort()).toEqual(
      [
        `${APP}/Contents/MacOS/bspatch`,
        `${APP}/Contents/MacOS/bun`,
        `${APP}/Contents/MacOS/launcher`,
        `${APP}/Contents/MacOS/zig-zstd`,
      ].sort()
    );
  });

  test("never selects the vendored @oven bun for signing", () => {
    const targets = classifyNestedSigningTargets(APP, bundleCandidates());

    expect(targets.machOExecutables).not.toContain(VENDORED_BUN);
    expect(targets.extensionMatched).not.toContain(VENDORED_BUN);
    expect(targets.skipped).toEqual([VENDORED_BUN]);
  });

  test("extension-matched pass still selects all 18 dylib/so/node files", () => {
    const targets = classifyNestedSigningTargets(APP, bundleCandidates());

    expect(targets.extensionMatched).toHaveLength(18);
    for (const target of targets.extensionMatched) {
      expect(
        target.endsWith(".dylib") ||
          target.endsWith(".so") ||
          target.endsWith(".node")
      ).toBe(true);
    }
  });

  test("covers every Mach-O file exactly once across the three sets", () => {
    const candidates = bundleCandidates();
    const targets = classifyNestedSigningTargets(APP, candidates);
    const classified = [
      ...targets.extensionMatched,
      ...targets.machOExecutables,
      ...targets.skipped,
    ];

    expect(classified).toHaveLength(23);
    expect(new Set(classified).size).toBe(23);
    expect(new Set(classified)).toEqual(
      new Set(
        candidates.filter((entry) => entry.isMachO).map((entry) => entry.path)
      )
    );
  });

  test("ignores non-Mach-O entries produced by the walk", () => {
    const targets = classifyNestedSigningTargets(APP, [
      { path: `${APP}/Contents/Info.plist`, isMachO: false },
      { path: `${APP}/Contents/MacOS/README.txt`, isMachO: false },
    ]);

    expect(targets.extensionMatched).toEqual([]);
    expect(targets.machOExecutables).toEqual([]);
    expect(targets.skipped).toEqual([]);
  });

  test("orders each set deepest path first so nested code signs first", () => {
    const targets = classifyNestedSigningTargets(APP, bundleCandidates());
    const lengths = targets.extensionMatched.map((path) => path.length);

    expect(lengths).toEqual([...lengths].sort((left, right) => right - left));
  });

  test("does not treat nested Contents/MacOS-like paths as executables", () => {
    const decoy = `${APP}/Contents/Resources/app/Nested.app/Contents/MacOS/helper`;
    const targets = classifyNestedSigningTargets(APP, [machO(decoy)]);

    expect(targets.machOExecutables).toEqual([]);
    expect(targets.skipped).toEqual([decoy]);
  });
});

describe("isPotentialSigningPath", () => {
  test("probes only extension candidates and direct Contents/MacOS entries", () => {
    expect(isPotentialSigningPath(APP, `${APP}/Contents/MacOS/bun`)).toBe(true);
    expect(
      isPotentialSigningPath(
        APP,
        `${APP}/Contents/Resources/app/native/addon.node`
      )
    ).toBe(true);
    expect(isPotentialSigningPath(APP, VENDORED_BUN)).toBe(false);
    expect(
      isPotentialSigningPath(APP, `${APP}/Contents/Resources/app/index.js`)
    ).toBe(false);
  });
});

describe("buildNestedSignArgv", () => {
  const identity = "Developer ID Application: Example (ABCDE12345)";
  const entitlements =
    "/repo/desktop/electrobun-shell/macos/gno-desktop.entitlements";

  test("applies --entitlements only to Contents/MacOS/bun", () => {
    const targets = classifyNestedSigningTargets(APP, bundleCandidates());
    const bunPath = bundledBunPath(APP);

    const commands = targets.machOExecutables.map((target) =>
      buildNestedSignArgv(
        target,
        identity,
        target === bunPath ? entitlements : null
      )
    );

    const withEntitlements = commands.filter((argv) =>
      argv.includes("--entitlements")
    );
    expect(withEntitlements).toHaveLength(1);
    expect(withEntitlements[0]?.at(-1)).toBe(`${APP}/Contents/MacOS/bun`);
    expect(withEntitlements[0]).toContain(entitlements);
  });

  test("resolves the entitlement target by explicit relative path", () => {
    expect(bundledBunPath(APP)).toBe(`${APP}/Contents/MacOS/bun`);
    expect(bundledBunPath(APP)).not.toBe(VENDORED_BUN);
  });

  test("helper executables carry no --entitlements", () => {
    for (const helper of ["launcher", "bspatch", "zig-zstd"]) {
      const argv = buildNestedSignArgv(
        `${APP}/Contents/MacOS/${helper}`,
        identity
      );
      expect(argv).not.toContain("--entitlements");
      expect(argv).toContain("--options");
      expect(argv).toContain("runtime");
    }
  });

  test("the extension-matched pass carries no --entitlements", () => {
    const targets = classifyNestedSigningTargets(APP, bundleCandidates());

    for (const target of targets.extensionMatched) {
      expect(buildNestedSignArgv(target, identity)).not.toContain(
        "--entitlements"
      );
    }
  });

  test("keeps --force, --timestamp and hardened runtime", () => {
    const argv = buildNestedSignArgv(
      bundledBunPath(APP),
      identity,
      entitlements
    );

    expect(argv[0]).toBe("codesign");
    expect(argv).toContain("--force");
    expect(argv).toContain("--timestamp");
    expect(argv.join(" ")).toContain("--options runtime");
    expect(argv).toContain("--sign");
    expect(argv[argv.indexOf("--sign") + 1]).toBe(identity);
  });
});

describe("buildBundleSignArgv", () => {
  const identity = "Developer ID Application: Example (ABCDE12345)";

  test("omits --deep, which would strip the per-binary entitlement", () => {
    expect(buildBundleSignArgv(APP, identity)).not.toContain("--deep");
  });

  test("retains the hardening flags the release path relies on", () => {
    const argv = buildBundleSignArgv(APP, identity);

    expect(argv[0]).toBe("codesign");
    expect(argv).toContain("--force");
    expect(argv).toContain("--strict");
    expect(argv).toContain("--timestamp");
    expect(argv.join(" ")).toContain("--options runtime");
    expect(argv[argv.indexOf("--sign") + 1]).toBe(identity);
    expect(argv.at(-1)).toBe(APP);
  });
});

describe("hasJitEntitlement", () => {
  test("passes when allow-jit is true", () => {
    const xml = entitlementsPlist(`  <key>${JIT_KEY}</key>
  <true/>`);

    expect(hasJitEntitlement(xml)).toBe(true);
  });

  test("fails when allow-jit is present but false", () => {
    const xml = entitlementsPlist(`  <key>${JIT_KEY}</key>
  <false/>`);

    expect(readEntitlementBoolean(xml, JIT_KEY)).toBe(false);
    expect(hasJitEntitlement(xml)).toBe(false);
  });

  test("fails on empty stdout, the zero-entitlement exit-0 case", () => {
    expect(hasJitEntitlement("")).toBe(false);
    expect(readEntitlementBoolean("", JIT_KEY)).toBeNull();
  });

  test("fails when other entitlements are present but allow-jit is not", () => {
    const xml =
      entitlementsPlist(`  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>`);

    expect(hasJitEntitlement(xml)).toBe(false);
  });

  test("fails on malformed non-plist stdout without throwing", () => {
    const malformed = `Executable=/tmp/x/Contents/MacOS/bun\n<key>${JIT_KEY}</key`;

    expect(() => hasJitEntitlement(malformed)).not.toThrow();
    expect(hasJitEntitlement(malformed)).toBe(false);
    expect(hasJitEntitlement("<<<not xml at all>>>")).toBe(false);
  });

  test("is not fooled by the key appearing as plain text", () => {
    expect(hasJitEntitlement(`some log line mentioning ${JIT_KEY}`)).toBe(
      false
    );
  });

  test("tolerates whitespace and CRLF inside the plist", () => {
    const xml = entitlementsPlist(`  <key> ${JIT_KEY} </key>\r\n  <true />`);

    expect(hasJitEntitlement(xml)).toBe(true);
  });

  test("fails on a truncated plist that still contains the key", () => {
    // A short read can end right after the value. The key regex matches, so
    // without a completeness check this is a false green on the release gate.
    const truncated = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>${JIT_KEY}</key><true/>`;

    expect(hasJitEntitlement(truncated)).toBe(false);
    expect(readEntitlementBoolean(truncated, JIT_KEY)).toBeNull();
  });

  test("fails when the closing dict is missing", () => {
    const unbalanced = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>${JIT_KEY}</key><true/></plist>`;

    expect(hasJitEntitlement(unbalanced)).toBe(false);
  });

  test("fails when the plist envelope is never closed", () => {
    const unclosed = `<plist version="1.0"><dict><key>${JIT_KEY}</key><true/></dict>`;

    expect(hasJitEntitlement(unclosed)).toBe(false);
  });

  test("fails when the key sits outside the root dict", () => {
    // Balanced dict tags and a closed plist, but the entitlement is not a
    // member of the dictionary. A tag-counting check accepts this.
    const outside = `<plist version="1.0"><dict></dict><key>${JIT_KEY}</key><true/></plist>`;

    expect(hasJitEntitlement(outside)).toBe(false);
  });

  test("fails when the key is buried in a nested dict", () => {
    const nested = `<plist version="1.0"><dict><key>outer</key><dict><key>${JIT_KEY}</key><true/></dict></dict></plist>`;

    expect(hasJitEntitlement(nested)).toBe(false);
  });

  test("fails when the key is inside an array", () => {
    const inArray = `<plist version="1.0"><dict><key>things</key><array><key>${JIT_KEY}</key><true/></array></dict></plist>`;

    expect(hasJitEntitlement(inArray)).toBe(false);
  });

  test("fails on trailing content after the plist closes", () => {
    const trailing = `${entitlementsPlist(`<key>${JIT_KEY}</key><true/>`)}<plist><dict/></plist>`;

    expect(hasJitEntitlement(trailing)).toBe(false);
  });

  test("fails when the entitlement only appears inside a comment", () => {
    const commented = `<plist version="1.0"><dict><!-- <key>${JIT_KEY}</key><true/> --></dict></plist>`;

    expect(hasJitEntitlement(commented)).toBe(false);
  });

  test("fails when the entitlement only appears inside CDATA", () => {
    const cdata = `<plist version="1.0"><dict><![CDATA[<key>${JIT_KEY}</key><true/>]]></dict></plist>`;

    expect(hasJitEntitlement(cdata)).toBe(false);
  });

  test("fails on an unterminated comment rather than dropping the rest", () => {
    const unterminated = `<plist version="1.0"><dict><!-- <key>${JIT_KEY}</key><true/></dict></plist>`;

    expect(hasJitEntitlement(unterminated)).toBe(false);
  });

  test("reads the key when an unrelated comment is present", () => {
    const xml = `<plist version="1.0"><dict><!-- granted for JavaScriptCore --><key>${JIT_KEY}</key><true/></dict></plist>`;

    expect(hasJitEntitlement(xml)).toBe(true);
  });

  test("still reads the key when other entitlements surround it", () => {
    const xml = `<plist version="1.0"><dict><key>com.apple.security.cs.other</key><false/><key>things</key><array><string>x</string></array><key>${JIT_KEY}</key><true/></dict></plist>`;

    expect(hasJitEntitlement(xml)).toBe(true);
  });
});

describe("hasHardenedRuntimeFlag", () => {
  test("detects flags=0x10000(runtime) from codesign -dvvv stderr", () => {
    const stderr = `Executable=/tmp/x/Contents/MacOS/bun
Identifier=bun
CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=12+7
Signature size=9000
`;

    expect(hasHardenedRuntimeFlag(stderr)).toBe(true);
  });

  test("detects runtime among several flags", () => {
    expect(
      hasHardenedRuntimeFlag("flags=0x10002(adhoc,runtime) hashes=12+7")
    ).toBe(true);
  });

  test("fails when the runtime flag is absent", () => {
    const stderr = `Executable=/tmp/x/Contents/MacOS/bun
CodeDirectory v=20400 size=1234 flags=0x2(adhoc) hashes=12+7
`;

    expect(hasHardenedRuntimeFlag(stderr)).toBe(false);
  });

  test("fails when no flags line is present at all", () => {
    expect(hasHardenedRuntimeFlag("")).toBe(false);
    expect(
      hasHardenedRuntimeFlag("/tmp/x: code object is not signed at all")
    ).toBe(false);
  });

  test("is not fooled by a flag that merely contains 'runtime'", () => {
    expect(hasHardenedRuntimeFlag("flags=0x4(no-runtime-here)")).toBe(false);
  });
});
