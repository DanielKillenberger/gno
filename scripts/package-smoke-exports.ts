// node:fs/promises provides directory creation; Bun has no structural equivalent.
import { mkdir } from "node:fs/promises";
// node:path provides path composition; Bun has no path utilities.
import { join } from "node:path";

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface ExportSmokeInput {
  gnoBin: string;
  cwd: string;
  env: Record<string, string>;
  configDir: string;
  tempRoot: string;
  runCommand: (
    command: string[],
    cwd: string,
    env: Record<string, string>
  ) => CommandResult;
}

interface SearchResultShape {
  uri?: string;
  source?: { relPath?: string };
  record?: {
    sourceLocator?: string;
    adapter?: { id?: string; version?: string; fingerprint?: string };
  };
}

const parseObject = (value: string, label: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} did not return a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

/** Prove the packed CLI can configure, index, search, and get an export record. */
export async function verifyPackedExportAdapters(
  input: ExportSmokeInput
): Promise<void> {
  const exportRoot = join(input.tempRoot, "packed-exports");
  await mkdir(exportRoot, { recursive: true });
  await Bun.write(
    join(exportRoot, "decisions.jsonl"),
    `${JSON.stringify({
      id: "packed-export-sentinel",
      title: "Packed export sentinel",
      body: "package export adapter evidence",
      author: "Package Smoke",
    })}\n`
  );

  const configPath = join(input.configDir, "index.yml");
  const config = (await Bun.file(configPath)
    .json()
    .catch(async () => Bun.YAML.parse(await Bun.file(configPath).text()))) as {
    collections?: Array<Record<string, unknown>>;
  };
  config.collections ??= [];
  config.collections.push({
    name: "packed-exports",
    path: exportRoot,
    pattern: "**/*",
    include: [],
    exclude: [],
    recordAdapters: {
      jsonl: {
        fieldMapping: {
          id: "/id",
          title: "/title",
          body: "/body",
          author: "/author",
        },
      },
    },
  });
  await Bun.write(configPath, Bun.YAML.stringify(config));

  input.runCommand([input.gnoBin, "update", "--yes"], input.cwd, input.env);
  const search = parseObject(
    input.runCommand(
      [input.gnoBin, "search", "package export adapter evidence", "--json"],
      input.cwd,
      input.env
    ).stdout,
    "packed export search"
  );
  const results = search.results;
  if (!Array.isArray(results)) {
    throw new Error("packed export search omitted results");
  }
  const record = (results as SearchResultShape[]).find(
    (result) => result.source?.relPath === "decisions.jsonl"
  );
  if (
    !record?.uri ||
    record.record?.sourceLocator !== "line:1" ||
    record.record.adapter?.id !== "adapter/jsonl" ||
    !/^[a-f0-9]{64}$/.test(record.record.adapter.fingerprint ?? "")
  ) {
    throw new Error(
      `packed export search lost record provenance:\n${JSON.stringify(record, null, 2)}`
    );
  }

  const fetched = parseObject(
    input.runCommand(
      [input.gnoBin, "get", record.uri, "--json"],
      input.cwd,
      input.env
    ).stdout,
    "packed export get"
  );
  if (
    (fetched.source as { relPath?: string } | undefined)?.relPath !==
      "decisions.jsonl" ||
    (fetched.record as SearchResultShape["record"] | undefined)?.adapter?.id !==
      "adapter/jsonl"
  ) {
    throw new Error("packed export get lost source or adapter provenance");
  }
}
