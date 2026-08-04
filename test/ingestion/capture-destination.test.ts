/**
 * Destination safety for paths GNO itself writes into a collection.
 *
 * `mkdir(dir, { recursive: true })` FOLLOWS an existing directory symlink, so
 * every capture/create site that used it wrote first and asked the index
 * second. These pin the pre-write refusal and the post-write proof.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../../src/config/types";
import type { DocumentRow, StorePort } from "../../src/store/types";

import {
  CaptureDestinationError,
  prepareCaptureDestination,
  requireActiveCaptureDocument,
} from "../../src/ingestion/capture-destination";
import { SyncService } from "../../src/ingestion/sync";
import { SqliteAdapter } from "../../src/store/sqlite/adapter";
import { safeRm } from "../helpers/cleanup";

const documentStub = (active: boolean): DocumentRow =>
  ({
    id: 1,
    collection: "notes",
    relPath: "note.md",
    docid: "doc-1",
    uri: "gno://notes/note.md",
    active,
  }) as unknown as DocumentRow;

const storeStub = (
  value: DocumentRow | null,
  failure?: string
): Pick<StorePort, "getDocument"> => ({
  getDocument: async () =>
    failure
      ? { ok: false, error: { code: "QUERY_FAILED", message: failure } }
      : { ok: true, value },
});

describe("prepareCaptureDestination", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gno-capture-dest-"));
    outside = await mkdtemp(join(tmpdir(), "gno-capture-out-"));
  });

  afterEach(async () => {
    await safeRm(root);
    await safeRm(outside);
  });

  test("creates a real nested parent chain and returns the destination", async () => {
    const absPath = await prepareCaptureDestination(root, "a/b/note.md");

    expect(absPath).toBe(join(root, "a", "b", "note.md"));
    expect((await lstat(join(root, "a", "b"))).isDirectory()).toBe(true);
    await writeFile(absPath, "body");
    expect(await Bun.file(absPath).text()).toBe("body");
  });

  test("accepts an already-real parent chain unchanged", async () => {
    await mkdir(join(root, "a", "b"), { recursive: true });
    await writeFile(join(root, "a", "b", "note.md"), "old");

    const absPath = await prepareCaptureDestination(root, "a/b/note.md");

    expect(absPath).toBe(join(root, "a", "b", "note.md"));
    expect(await Bun.file(absPath).text()).toBe("old");
  });

  test("refuses a parent symlink that stays inside the collection", async () => {
    await mkdir(join(root, "real"), { recursive: true });
    await symlink(join(root, "real"), join(root, "alias"));

    const error = (await prepareCaptureDestination(root, "alias/note.md").then(
      () => null,
      (cause: unknown) => cause
    )) as CaptureDestinationError | null;

    expect(error).toBeInstanceOf(CaptureDestinationError);
    expect(error?.code).toBe("PATH_NOT_WALKABLE");
    // Nothing may be written, here or through the alias.
    expect(await Bun.file(join(root, "real", "note.md")).exists()).toBe(false);
  });

  test("refuses a parent symlink escaping the collection as containment", async () => {
    await symlink(outside, join(root, "escape"));

    const error = (await prepareCaptureDestination(root, "escape/note.md").then(
      () => null,
      (cause: unknown) => cause
    )) as CaptureDestinationError | null;

    expect(error).toBeInstanceOf(CaptureDestinationError);
    expect(error?.code).toBe("PATH_OUTSIDE_COLLECTION");
    expect(await Bun.file(join(outside, "note.md")).exists()).toBe(false);
  });

  test("refuses a DANGLING escaping parent symlink as containment", async () => {
    await symlink(join(outside, "missing"), join(root, "escape"));

    const error = (await prepareCaptureDestination(root, "escape/note.md").then(
      () => null,
      (cause: unknown) => cause
    )) as CaptureDestinationError | null;

    expect(error?.code).toBe("PATH_OUTSIDE_COLLECTION");
  });

  test("classifies a DANGLING alias inside a SYMLINKED collection root as unwalkable", async () => {
    // The root is legitimately reached through a symlink (`/tmp -> /private/tmp`
    // is the everyday case). Containment is judged against the CANONICAL root,
    // so a lexical dangling target - which still carries the link path - looks
    // like an escape when it is nothing of the sort.
    const realRoot = join(root, "real-root");
    const linkedRoot = join(root, "linked-root");
    await mkdir(realRoot, { recursive: true });
    await symlink(realRoot, linkedRoot);
    await symlink(join(linkedRoot, "missing"), join(linkedRoot, "alias"));

    const error = (await prepareCaptureDestination(
      linkedRoot,
      "alias/note.md"
    ).then(
      () => null,
      (cause: unknown) => cause
    )) as CaptureDestinationError | null;

    expect(error?.code).toBe("PATH_NOT_WALKABLE");
  });

  test("classifies a DANGLING alias under a symlinked ancestor as containment", async () => {
    // `root/hop -> outside/real` exists, so `root/hop/missing` is lexically
    // inside the collection and canonically outside it, and the collection
    // path here is the CANONICAL root so nothing else can explain the verdict.
    // Only canonical resolution is the truth about where a write would land.
    const canonicalRoot = await realpath(root);
    await mkdir(join(outside, "real"), { recursive: true });
    await symlink(join(outside, "real"), join(canonicalRoot, "hop"));
    await symlink(
      join(canonicalRoot, "hop", "missing"),
      join(canonicalRoot, "alias")
    );

    const error = (await prepareCaptureDestination(
      canonicalRoot,
      "alias/note.md"
    ).then(
      () => null,
      (cause: unknown) => cause
    )) as CaptureDestinationError | null;

    expect(error?.code).toBe("PATH_OUTSIDE_COLLECTION");
  });

  test("refuses an alias whose target cannot be resolved at all", async () => {
    // `ENOTDIR`, not `ENOENT`: the target's ancestor is a regular file, so the
    // destination is unknowable rather than merely absent. Guessing lexically
    // here is what let a real escape read as "just not indexable".
    await writeFile(join(root, "file.txt"), "body");
    await symlink(join(root, "file.txt", "under-a-file"), join(root, "alias"));

    const error = (await prepareCaptureDestination(root, "alias/note.md").then(
      () => null,
      (cause: unknown) => cause
    )) as CaptureDestinationError | null;

    expect(error?.code).toBe("PATH_UNRESOLVED");
  });

  test("refuses a symlinked leaf name", async () => {
    await writeFile(join(root, "real.md"), "body");
    await symlink(join(root, "real.md"), join(root, "alias.md"));

    const error = (await prepareCaptureDestination(root, "alias.md").then(
      () => null,
      (cause: unknown) => cause
    )) as CaptureDestinationError | null;

    expect(error?.code).toBe("PATH_NOT_WALKABLE");
    expect(await Bun.file(join(root, "real.md")).text()).toBe("body");
  });

  test("refuses a lexically escaping relative path", async () => {
    const error = (await prepareCaptureDestination(root, "../note.md").then(
      () => null,
      (cause: unknown) => cause
    )) as CaptureDestinationError | null;

    expect(error?.code).toBe("PATH_OUTSIDE_COLLECTION");
  });

  test("refuses a parent component that exists but is not a directory", async () => {
    await writeFile(join(root, "a"), "not a directory");

    const error = (await prepareCaptureDestination(root, "a/note.md").then(
      () => null,
      (cause: unknown) => cause
    )) as CaptureDestinationError | null;

    expect(error?.code).toBe("NOT_DIRECTORY");
  });
});

describe("requireActiveCaptureDocument", () => {
  test("accepts an active document", async () => {
    const result = await requireActiveCaptureDocument(
      storeStub(documentStub(true)),
      "notes",
      "note.md"
    );

    expect(result.ok).toBe(true);
  });

  test("refuses a missing document - the case a skipped sync leaves behind", async () => {
    const result = await requireActiveCaptureDocument(
      storeStub(null),
      "notes",
      "note.md"
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("not indexed");
  });

  test("refuses an inactive document", async () => {
    const result = await requireActiveCaptureDocument(
      storeStub(documentStub(false)),
      "notes",
      "note.md"
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("inactive");
  });

  test("refuses when the store lookup itself fails", async () => {
    const result = await requireActiveCaptureDocument(
      storeStub(null, "db gone"),
      "notes",
      "note.md"
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe("db gone");
  });
});

/**
 * The proof is by EFFECTIVE SOURCE PATH, not by `rel_path`.
 *
 * A capture whose destination is a configured record-container format is
 * imported as LOGICAL documents under virtual `#record/...` rel paths, with the
 * written file in `record_source_path`. A `rel_path`-only proof calls that
 * successful import "not indexed" and the receipt reports FAILURE - so these
 * run against a real store and a real sync, not a stub.
 */
describe("requireActiveCaptureDocument - record containers", () => {
  let root: string;
  let store: SqliteAdapter;
  let collection: Config["collections"][number];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gno-capture-records-"));
    store = new SqliteAdapter();
    expect((await store.open(join(root, "index.db"), "unicode61")).ok).toBe(
      true
    );
    collection = {
      name: "captures",
      path: root,
      pattern: "**/*",
      include: [],
      exclude: [],
      recordAdapters: {
        jsonl: {
          fieldMapping: {
            id: "/id",
            title: "/title",
            body: "/text",
            dateFields: { created: "/created" },
          },
        },
        transcript: { format: "vtt" },
      },
    };
    expect((await store.syncCollections([collection])).ok).toBe(true);
  });

  afterEach(async () => {
    await store.close();
    await safeRm(root);
  });

  const syncCollection = async () => {
    const result = await new SyncService().syncCollection(collection, store, {
      projectTypedEdges: false,
    });
    expect(result.filesErrored).toBe(0);
    return result;
  };

  test("a captured .jsonl record container satisfies the proof", async () => {
    const relPath = "export.jsonl";
    await Bun.write(
      join(root, relPath),
      `${[
        {
          id: "launch",
          title: "Launch decision",
          text: "Project Zephyr launches Friday",
          created: "2026-07-22T09:00:00Z",
        },
        {
          id: "budget",
          title: "Budget decision",
          text: "Budget remains capped at forty units",
          created: "2026-07-22T10:00:00Z",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`
    );
    await syncCollection();

    // The container itself has no `rel_path` document - only logical records.
    const direct = await store.getDocument("captures", relPath);
    expect(direct.ok && direct.value).toBeNull();

    const result = await requireActiveCaptureDocument(
      store,
      "captures",
      relPath
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.document.recordSourcePath).toBe(relPath);
    expect(result.ok && result.document.active).toBe(true);
    // Multiple logical records from one written file is the normal case.
    const records = await store.listRecordDocuments("captures", relPath);
    expect(
      records.ok && records.value.filter((row) => row.active)
    ).toHaveLength(2);
  });

  test("a captured .vtt transcript container satisfies the proof", async () => {
    const relPath = "meeting.vtt";
    await Bun.write(
      join(root, relPath),
      Bun.file(
        join(import.meta.dir, "../fixtures/exports/transcript/sample.vtt")
      )
    );
    await syncCollection();

    const direct = await store.getDocument("captures", relPath);
    expect(direct.ok && direct.value).toBeNull();

    const result = await requireActiveCaptureDocument(
      store,
      "captures",
      relPath
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.document.recordSourcePath).toBe(relPath);
    expect(result.ok && result.document.active).toBe(true);
  });

  test("an ordinary markdown capture still satisfies the proof by rel_path", async () => {
    const relPath = "note.md";
    await Bun.write(join(root, relPath), "# Note\n\nordinary capture body\n");
    await syncCollection();

    const result = await requireActiveCaptureDocument(
      store,
      "captures",
      relPath
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.document.relPath).toBe(relPath);
    expect(result.ok && result.document.recordSourcePath).toBeFalsy();
  });

  test("an unindexed write still FAILS the proof - the fallback is not a rubber stamp", async () => {
    await syncCollection();
    // Written after the sync: on disk, in no index.
    await Bun.write(join(root, "unindexed.jsonl"), '{"id":"a","text":"b"}\n');

    const result = await requireActiveCaptureDocument(
      store,
      "captures",
      "unindexed.jsonl"
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("not indexed");
  });

  test("a deactivated record container FAILS the proof", async () => {
    const relPath = "export.jsonl";
    await Bun.write(
      join(root, relPath),
      '{"id":"one","title":"One","text":"first body"}\n'
    );
    await syncCollection();
    expect(
      (await requireActiveCaptureDocument(store, "captures", relPath)).ok
    ).toBe(true);

    // An authoritative empty snapshot deactivates every logical record.
    await Bun.write(join(root, relPath), "");
    await syncCollection();

    const result = await requireActiveCaptureDocument(
      store,
      "captures",
      relPath
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("not indexed");
  });
});
