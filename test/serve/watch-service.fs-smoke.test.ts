import { afterAll, describe, expect, test } from "bun:test";
/**
 * Real-filesystem capture of what Bun's recursive `node:fs.watch` actually
 * reports for the four write/delete sequences that matter to fn-114.
 *
 * This file captures event SHAPE. It deliberately asserts only invariants that
 * hold on every platform, because the defect under investigation
 * (oven-sh/bun#36328) is itself platform-specific: on Linux an atomic
 * temp-write + rename forwards only the SOURCE (temp) name, while macOS
 * reports both the source and the destination. Asserting "the final name is
 * never reported" would encode a platform defect as an expectation; asserting
 * "the final name is always reported" would go green on macOS and red on the
 * platform the bug was reported from. Neither is useful, so the captured
 * sequence is recorded instead.
 *
 * Set GNO_WATCH_CAPTURE_OUT=<path> to write the captured sequences as JSON for
 * task evidence.
 */
import { mkdtempSync, rmSync, watch } from "node:fs";
// node:fs/promises is used for mkdtemp/rename/unlink/rm: Bun has no native
// equivalents for temp-directory creation or filesystem structure operations.
import { mkdir, mkdtemp, rename, rm, unlink } from "node:fs/promises";
import { platform, release, tmpdir } from "node:os";
import { join } from "node:path";

type CapturedEvent = readonly [eventType: string, filename: string | null];

const HARD_TIMEOUT_MS = 20_000;
const EVENT_WAIT_MS = 4000;
const DRAIN_MS = 250;

/**
 * Recursive fs.watch is not available on every runtime/platform combination
 * (notably older Linux runtimes without inotify recursion support). Probe once,
 * synchronously, so the suite can skip cleanly instead of hanging.
 */
const recursiveWatchSupported = (() => {
  let probeDir: string | undefined;
  try {
    probeDir = mkdtempSync(join(tmpdir(), "gno-watch-probe-"));
    const watcher = watch(probeDir, { recursive: true }, () => undefined);
    watcher.close();
    return true;
  } catch {
    return false;
  } finally {
    if (probeDir) {
      try {
        rmSync(probeDir, { recursive: true, force: true });
      } catch {
        // best-effort probe cleanup
      }
    }
  }
})();

const capture: Record<string, CapturedEvent[]> = {};

afterAll(async () => {
  const outPath = process.env.GNO_WATCH_CAPTURE_OUT;
  if (!outPath) {
    return;
  }
  await Bun.write(
    outPath,
    `${JSON.stringify(
      {
        platform: platform(),
        release: release(),
        bun: Bun.version,
        sequences: capture,
      },
      null,
      2
    )}\n`
  );
});

describe("recursive fs.watch event shapes", () => {
  test.skipIf(!recursiveWatchSupported)(
    "captures create, atomic rename, atomic replacement and deletion sequences",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gno-watch-shape-"));
      const events: CapturedEvent[] = [];
      let notify: (() => void) | null = null;

      const watcher = watch(
        root,
        { recursive: true },
        (eventType, filename) => {
          events.push([
            String(eventType),
            filename === null || filename === undefined
              ? null
              : String(filename).replaceAll("\\", "/"),
          ]);
          notify?.();
        }
      );

      /**
       * Event-driven wait: resolves as soon as the watcher reports an event
       * matching `predicate`, then drains whatever else the platform coalesces
       * into the same batch. The timeout is a hard failure bound, not a settle
       * signal.
       */
      const waitForEvent = async (
        predicate: (event: CapturedEvent) => boolean
      ): Promise<CapturedEvent[]> => {
        const seen = () => events.some((event) => predicate(event));
        if (!seen()) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              notify = null;
              resolve();
            }, EVENT_WAIT_MS);
            notify = () => {
              if (seen()) {
                clearTimeout(timer);
                notify = null;
                resolve();
              }
            };
          });
        }
        // Drain sibling events the kernel/runtime batched with this one.
        await Bun.sleep(DRAIN_MS);
        return events.splice(0, events.length);
      };

      const named = (name: string) => (event: CapturedEvent) =>
        event[1] === name;

      try {
        await mkdir(join(root, "nested"), { recursive: true });
        await waitForEvent(named("nested"));

        // 1. direct create/write of an eligible file
        await Bun.write(join(root, "direct.md"), "# direct\n");
        capture.directCreate = await waitForEvent(named("direct.md"));

        // 2. atomic temp-write + rename creating a new eligible file
        await Bun.write(join(root, ".gno-tmp.abc123"), "# atomic\n");
        await rename(join(root, ".gno-tmp.abc123"), join(root, "atomic.md"));
        capture.atomicCreate = await waitForEvent(named(".gno-tmp.abc123"));

        // 3. atomic replacement of an existing eligible file
        await Bun.write(join(root, ".gno-tmp.def456"), "# atomic v2\n");
        await rename(join(root, ".gno-tmp.def456"), join(root, "atomic.md"));
        capture.atomicReplace = await waitForEvent(named(".gno-tmp.def456"));

        // 4. deletion of an eligible file
        await unlink(join(root, "direct.md"));
        capture.deletion = await waitForEvent(named("direct.md"));

        // 5. nested-directory variant of the atomic create
        await Bun.write(join(root, "nested", ".gno-tmp.ghi789"), "# nested\n");
        await rename(
          join(root, "nested", ".gno-tmp.ghi789"),
          join(root, "nested", "nested-atomic.md")
        );
        capture.nestedAtomicCreate = await waitForEvent(
          named("nested/.gno-tmp.ghi789")
        );

        // 6. case-only rename (documented, not acted on in this slice)
        await Bun.write(join(root, "Foo.md"), "# foo\n");
        await waitForEvent(named("Foo.md"));
        await rename(join(root, "Foo.md"), join(root, "foo.md"));
        capture.caseOnlyRename = await waitForEvent(named("Foo.md"));
      } finally {
        watcher.close();
        await rm(root, { recursive: true, force: true });
      }

      // Invariants that hold on every platform.
      for (const [label, sequence] of Object.entries(capture)) {
        expect(sequence.length, `${label} reported no events`).toBeGreaterThan(
          0
        );
        for (const [eventType, filename] of sequence) {
          expect(typeof eventType).toBe("string");
          expect(filename === null || typeof filename === "string").toBe(true);
        }
      }

      // The source (temporary) name is always reported for an atomic save; the
      // destination name is what Bun drops on Linux (oven-sh/bun#36328).
      expect(capture.atomicCreate.map(([, name]) => name)).toContain(
        ".gno-tmp.abc123"
      );
      expect(capture.atomicReplace.map(([, name]) => name)).toContain(
        ".gno-tmp.def456"
      );
      expect(capture.nestedAtomicCreate.map(([, name]) => name)).toContain(
        "nested/.gno-tmp.ghi789"
      );

      // The eligible file is always named for a direct write and a deletion.
      expect(capture.directCreate.map(([, name]) => name)).toContain(
        "direct.md"
      );
      expect(capture.deletion.map(([, name]) => name)).toContain("direct.md");
    },
    HARD_TIMEOUT_MS
  );
});
