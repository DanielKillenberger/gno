import type {
  RecordAdapter,
  RecordAdapterEvent,
  RecordAdapterInput,
} from "../../types";

import {
  type BrowserExportRecord,
  parseBrowserJson,
  parseNetscapeBookmarks,
} from "./formats";

const LIVE_PROFILE_MARKERS = [
  "/library/safari/",
  "/chrome/user data/",
  "/google/chrome/",
  "/chromium/user data/",
  "/.config/google-chrome/",
  "/.config/chromium/",
  "/appdata/local/google/chrome/user data/",
  "/firefox/profiles/",
  "/.mozilla/firefox/",
  "/mozilla/firefox/",
  "/appdata/roaming/mozilla/firefox/profiles/",
];

const safeMarkdown = (value: string): string =>
  value
    .normalize("NFC")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_[\]#])/g, "\\$1")
    .trim();

const liveProfileReason = (input: RecordAdapterInput): string | undefined => {
  const normalized = input.sourcePath.replaceAll("\\", "/").toLowerCase();
  if (LIVE_PROFILE_MARKERS.some((marker) => normalized.includes(marker))) {
    return "live-profile";
  }
  const basename = normalized.split("/").at(-1);
  if (
    basename === "cookies" ||
    basename === "history" ||
    basename?.endsWith(".sqlite") ||
    basename?.endsWith(".db")
  ) {
    return "live-database";
  }
  return undefined;
};

const normalizeUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    if (url.username || url.password) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
};

const readSource = async (input: RecordAdapterInput): Promise<string> => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let source = "";
  for await (const chunk of input.open()) {
    source += decoder.decode(chunk, { stream: true });
  }
  return source + decoder.decode();
};

const recordEvent = (
  record: BrowserExportRecord
): RecordAdapterEvent | undefined => {
  const url = normalizeUrl(record.url);
  if (!url) return undefined;
  const title = safeMarkdown(record.title || url);
  const folder = record.folder ? safeMarkdown(record.folder) : undefined;
  const tags = record.tags?.map(safeMarkdown).filter(Boolean);
  const lines = [`# ${title}`, "", url];
  if (folder) lines.push("", `Folder: ${folder}`);
  if (tags && tags.length > 0) lines.push(`Tags: ${tags.join(", ")}`);
  for (const [name, value] of Object.entries(record.dates ?? {}).sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    lines.push(`${safeMarkdown(name)}: ${safeMarkdown(value)}`);
  }
  const identity = record.externalId
    ? `${record.kind}:id:${record.externalId}`
    : `${record.kind}:url:${url}`;
  return {
    type: "record",
    record: {
      stableId: `browser:${identity}`,
      sourceLocator: record.sourceLocator,
      markdown: lines.join("\n"),
      title,
      metadata: {
        categories: ["browser-export", record.kind, ...(tags ?? [])],
        dateFields: record.dates,
      },
      anchors: [{ kind: "record", value: record.sourceLocator }],
    },
  };
};

async function* parseBrowserExport(
  input: RecordAdapterInput
): AsyncGenerator<RecordAdapterEvent> {
  const denied = liveProfileReason(input);
  if (denied) {
    yield {
      type: "failure",
      failure: {
        code: "ADAPTER_FAILURE",
        message: "Live browser profile access is not allowed.",
        retryable: false,
        sourceLocator: denied,
      },
    };
    yield { type: "snapshot", state: "partial" };
    return;
  }

  let source: string;
  try {
    source = await readSource(input);
  } catch {
    yield {
      type: "failure",
      failure: {
        code: "MALFORMED_RECORD",
        message: "Browser export could not be decoded.",
        retryable: true,
        sourceLocator: "export",
      },
    };
    yield { type: "snapshot", state: "partial" };
    return;
  }
  const trimmed = source.trimStart();
  const parsed = trimmed.startsWith("<")
    ? parseNetscapeBookmarks(
        source,
        input.limits.maxRecords,
        input.limits.maxFailures
      )
    : parseBrowserJson(
        source,
        input.limits.maxRecords,
        input.limits.maxFailures
      );
  let failures = parsed.failures.length;
  for (const candidate of parsed.records) {
    const event = recordEvent(candidate);
    if (event) yield event;
    else {
      failures += 1;
      yield {
        type: "failure",
        failure: {
          code: "MALFORMED_RECORD",
          message: "Browser export contained an invalid or unsafe URL.",
          retryable: false,
          sourceLocator: candidate.sourceLocator,
        },
      };
    }
  }
  for (const locator of parsed.failures) {
    yield {
      type: "failure",
      failure: {
        code: "MALFORMED_RECORD",
        message: "Browser export record could not be parsed.",
        retryable: false,
        sourceLocator: locator,
      },
    };
  }
  yield {
    type: "snapshot",
    state: failures === 0 ? "complete" : "partial",
  };
}

export const browserExportAdapter: RecordAdapter = {
  id: "adapter/browser-export",
  version: "1.0.0",
  canHandle: (mime, ext) =>
    mime === "application/x-gno-browser-export+json" ||
    mime === "text/x-gno-browser-bookmarks+html" ||
    ext === ".browser-export",
  records: parseBrowserExport,
};
