/**
 * WebUI first-page-load harness (fn-124).
 *
 * Recipe (repeatable):
 *   bun run test:e2e:install
 *   bun run bench:webui-first-page
 *
 * Bars (same machine story):
 *   R1  P95 first paint of home chrome ≤ 200ms
 *   R8  P95 TTI (Search click starts in-app navigation to /search) ≤ 1000ms
 *
 * Neither bar is filled Dashboard health data. This is not a 200ms TTI claim.
 *
 * Harness:
 *   - localhost production `gno serve` (no --dev)
 *   - N cold loads (default 20; override with --n)
 *   - new browser context per sample
 *   - CDP Network.setCacheDisabled=true
 *   - any first-document JS response from disk/prefetch/service-worker cache
 *     fails the run and does not publish a P95
 *
 * Selectors:
 *   first paint — in-page rAF until h1 "GNO" and nav Search are in the DOM
 *   TTI         — Playwright Search click → URL /search
 *
 * P95 math: nearest-rank, 19th of 20 sorted samples (ceil(0.95 * N)).
 */

// node:fs/promises for mkdtemp/mkdir/rm only; Bun lacks temp-dir helpers.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
// node:os — no Bun equivalent for the platform temporary directory.
import { tmpdir } from "node:os";
// node:path — no Bun path utils.
import { join } from "node:path";
import { chromium, type Page } from "playwright";

import { saveConfigToPath } from "../src/config/saver";
import { startBackgroundRuntime } from "../src/serve/background-runtime";

const DEFAULT_N = 20;
const FIRST_PAINT_P95_MS = 200;
const TTI_P95_MS = 1000;

type Sample = {
  firstPaintMs: number;
  ttiMs: number;
};

type NetworkResponseReceived = {
  response: {
    fromDiskCache?: boolean;
    fromPrefetchCache?: boolean;
    fromServiceWorker?: boolean;
    url: string;
  };
};

const isJsDocumentUrl = (url: string): boolean => {
  try {
    return new URL(url).pathname.endsWith(".js");
  } catch {
    return false;
  }
};

const parseN = (argv: string[]): number => {
  const flagIndex = argv.indexOf("--n");
  if (flagIndex === -1) {
    return DEFAULT_N;
  }
  const raw = argv[flagIndex + 1];
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid --n ${raw ?? ""}`);
  }
  return parsed;
};

const nearestRankP95 = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(0.95 * sorted.length);
  const value = sorted[rank - 1];
  if (value === undefined) {
    throw new Error("P95 requires at least one sample");
  }
  return value;
};

const waitForHealthy = async (baseUrl: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server still starting.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
};

const measureSample = async (page: Page, baseUrl: string): Promise<Sample> => {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  let cachedJs = false;
  session.on("Network.responseReceived", (event: NetworkResponseReceived) => {
    const { response } = event;
    if (
      isJsDocumentUrl(response.url) &&
      (response.fromDiskCache ||
        response.fromPrefetchCache ||
        response.fromServiceWorker)
    ) {
      cachedJs = true;
    }
  });

  await page.goto(baseUrl, { waitUntil: "commit" });
  let firstPaintMs: number;
  try {
    firstPaintMs = await page.evaluate(async () => {
      return await new Promise<number>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(
            new Error("Missing shell selector: h1 GNO and/or nav Search button")
          );
        }, 5000);
        const check = (): void => {
          const heading = document.querySelector("h1");
          const nav = document.querySelector("nav");
          const searchVisible = nav
            ? [...nav.querySelectorAll("button")].some(
                (button) => button.textContent?.trim() === "Search"
              )
            : false;
          if (heading?.textContent?.trim() === "GNO" && searchVisible) {
            window.clearTimeout(timeout);
            resolve(performance.now());
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
    });
  } catch {
    throw new Error("Missing shell selector: h1 GNO and/or nav Search button");
  }

  const search = page.getByRole("navigation").getByRole("button", {
    name: "Search",
  });
  await search.click();
  try {
    await page.waitForURL(/\/search(?:\?|$)/);
  } catch {
    throw new Error("Search click did not navigate toward /search");
  }
  const ttiMs = await page.evaluate(() => performance.now());

  if (cachedJs) {
    throw new Error("Warm JS cache: a first-document JS response was cached");
  }

  return { firstPaintMs, ttiMs };
};

const printReport = (
  n: number,
  samples: Sample[],
  firstPaintP95: number,
  ttiP95: number
): void => {
  console.log("WebUI first page load harness");
  console.log("  localhost production gno serve, cold JS cache");
  console.log(`  N=${n}  cache=CDP Network.setCacheDisabled + new context`);
  console.log("  first paint: heading GNO + nav Search visible");
  console.log("  TTI: Search click → /search  (not a 200ms TTI bar)");
  console.log("  health cards are excluded from both bars");
  console.log(
    "  recipe: bun run test:e2e:install && bun run bench:webui-first-page"
  );
  console.log("");
  console.log("samples (ms)");
  for (const [index, sample] of samples.entries()) {
    console.log(
      `  ${String(index + 1).padStart(2, "0")}  firstPaint=${sample.firstPaintMs.toFixed(1)}  tti=${sample.ttiMs.toFixed(1)}`
    );
  }
  console.log("");
  console.log(
    `P95 first paint  ${firstPaintP95.toFixed(1)} ms  (bar ${FIRST_PAINT_P95_MS} ms)`
  );
  console.log(
    `P95 TTI          ${ttiP95.toFixed(1)} ms  (bar ${TTI_P95_MS} ms)`
  );
};

async function main(): Promise<void> {
  const n = parseN(Bun.argv.slice(2));
  const root = await mkdtemp(join(tmpdir(), "gno-webui-first-page-"));
  const configDir = join(root, "config");
  const dataDir = join(root, "data");
  const cacheDir = join(root, "cache");
  const collectionDir = join(root, "collection");
  const configPath = join(configDir, "index.yml");
  const indexName = "webui-first-page";
  const port = 43000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;

  await mkdir(collectionDir, { recursive: true });
  await Bun.write(
    join(collectionDir, "note.md"),
    "# First page load\n\nHarness collection.\n"
  );

  const originalEnv = {
    GNO_CACHE_DIR: process.env.GNO_CACHE_DIR,
    GNO_CONFIG_DIR: process.env.GNO_CONFIG_DIR,
    GNO_DATA_DIR: process.env.GNO_DATA_DIR,
    GNO_OFFLINE: process.env.GNO_OFFLINE,
  };

  process.env.GNO_CONFIG_DIR = configDir;
  process.env.GNO_DATA_DIR = dataDir;
  process.env.GNO_CACHE_DIR = cacheDir;
  process.env.GNO_OFFLINE = "1";

  try {
    const saveResult = await saveConfigToPath(
      {
        collections: [
          {
            exclude: [],
            include: [],
            name: "notes",
            path: collectionDir,
            pattern: "**/*.md",
          },
        ],
        contexts: [],
        ftsTokenizer: "unicode61",
        version: "1.0",
      },
      configPath
    );
    if (!saveResult.ok) {
      throw new Error(saveResult.error.message);
    }

    const seedRuntime = await startBackgroundRuntime({
      configPath,
      index: indexName,
      offline: true,
    });
    if (!seedRuntime.success) {
      throw new Error(seedRuntime.error);
    }
    try {
      await seedRuntime.runtime.syncAll({ triggerEmbed: false });
    } finally {
      await seedRuntime.runtime.dispose();
    }

    const server = Bun.spawn(
      [
        "bun",
        "run",
        "src/index.ts",
        "--config",
        configPath,
        "--index",
        indexName,
        "serve",
        "--port",
        String(port),
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          GNO_CACHE_DIR: cacheDir,
          GNO_CONFIG_DIR: configDir,
          GNO_DATA_DIR: dataDir,
          GNO_OFFLINE: "1",
        },
        stderr: "inherit",
        stdout: "inherit",
      }
    );

    const browser = await chromium.launch();
    const samples: Sample[] = [];
    try {
      await waitForHealthy(baseUrl);

      for (let index = 0; index < n; index += 1) {
        const context = await browser.newContext({ serviceWorkers: "block" });
        const page = await context.newPage();
        try {
          samples.push(await measureSample(page, baseUrl));
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
      server.kill();
      await server.exited;
    }

    const firstPaintP95 = nearestRankP95(
      samples.map((sample) => sample.firstPaintMs)
    );
    const ttiP95 = nearestRankP95(samples.map((sample) => sample.ttiMs));
    printReport(n, samples, firstPaintP95, ttiP95);

    if (firstPaintP95 > FIRST_PAINT_P95_MS || ttiP95 > TTI_P95_MS) {
      throw new Error(
        `Harness bars missed: P95 first paint ${firstPaintP95.toFixed(1)}ms / P95 TTI ${ttiP95.toFixed(1)}ms`
      );
    }
  } finally {
    process.env.GNO_CONFIG_DIR = originalEnv.GNO_CONFIG_DIR;
    process.env.GNO_DATA_DIR = originalEnv.GNO_DATA_DIR;
    process.env.GNO_CACHE_DIR = originalEnv.GNO_CACHE_DIR;
    process.env.GNO_OFFLINE = originalEnv.GNO_OFFLINE;
    await rm(root, { force: true, recursive: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
