export type BrowserExportKind = "bookmark" | "history" | "reading-list";

export interface BrowserExportRecord {
  kind: BrowserExportKind;
  url: string;
  title?: string;
  folder?: string;
  tags?: string[];
  dates?: Record<string, string>;
  externalId?: string;
  sourceLocator: string;
}

export interface BrowserExportParseResult {
  records: BrowserExportRecord[];
  failures: string[];
}

const HTML_TAG_PATTERN = /<[^>]*>/g;
const EXECUTABLE_HTML_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TOKEN_PATTERN =
  /<H3\b[^>]*>([\s\S]*?)<\/H3\s*>|<A\b([^>]*)>([\s\S]*?)<\/A\s*>|<DL\b[^>]*>|<\/DL\s*>/gi;
const ATTRIBUTE_PATTERN = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const MAX_JSON_DEPTH = 32;
const WEBKIT_TO_UNIX_EPOCH_MS = 11_644_473_600_000;
const SENSITIVE_JSON_KEYS = new Set([
  "cookies",
  "passwords",
  "logins",
  "sessions",
  "creditCards",
]);
const SUPPORTED_JSON_KEYS = new Set([
  "roots",
  "children",
  "items",
  "bookmarks",
  "history",
  "readingList",
  "reading_list",
]);

const decodeEntities = (value: string): string =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

const plainText = (value: string): string =>
  decodeEntities(
    value.replace(EXECUTABLE_HTML_PATTERN, " ").replace(HTML_TAG_PATTERN, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

const attributes = (value: string): Map<string, string> => {
  const result = new Map<string, string>();
  for (const match of value.matchAll(ATTRIBUTE_PATTERN)) {
    const key = match[1]?.toLowerCase();
    const item = match[2] ?? match[3] ?? match[4];
    if (key && item !== undefined) result.set(key, decodeEntities(item));
  }
  return result;
};

const exportDate = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const epoch = Number(value);
  if (Number.isFinite(epoch) && epoch >= 0) {
    let milliseconds: number;
    if (epoch >= 10_000_000_000_000_000) {
      milliseconds = epoch / 1_000 - WEBKIT_TO_UNIX_EPOCH_MS;
    } else {
      milliseconds = epoch > 10_000_000_000 ? epoch : epoch * 1_000;
    }
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export function parseNetscapeBookmarks(
  source: string,
  maxRecords: number,
  maxFailures = 1_000
): BrowserExportParseResult {
  const records: BrowserExportRecord[] = [];
  const failures: string[] = [];
  const folders: string[] = [];
  let pendingFolder: string | undefined;
  let anchorNumber = 0;
  const addFailure = (locator: string): boolean => {
    if (failures.length < maxFailures) failures.push(locator);
    if (failures.length < maxFailures) return false;
    failures.push("failure-limit");
    return true;
  };
  if (!/<DL\b/i.test(source)) {
    addFailure("unsupported-html");
    return { records, failures };
  }
  for (const token of source.matchAll(HTML_TOKEN_PATTERN)) {
    const raw = token[0].toLowerCase();
    if (token[1] !== undefined) {
      pendingFolder = plainText(token[1]);
      continue;
    }
    if (raw.startsWith("<dl")) {
      if (pendingFolder) folders.push(pendingFolder);
      pendingFolder = undefined;
      continue;
    }
    if (raw.startsWith("</dl")) {
      folders.pop();
      continue;
    }
    if (token[2] === undefined || token[3] === undefined) continue;
    anchorNumber += 1;
    if (records.length >= maxRecords) {
      addFailure(`bookmark:${anchorNumber}/record-limit`);
      break;
    }
    const attrs = attributes(token[2]);
    const url = attrs.get("href");
    if (!url) {
      if (addFailure(`bookmark:${anchorNumber}`)) break;
      continue;
    }
    const rawAdded = attrs.get("add_date");
    const rawModified = attrs.get("last_modified");
    const added = exportDate(rawAdded);
    const modified = exportDate(rawModified);
    if ((rawAdded && !added) || (rawModified && !modified)) {
      if (addFailure(`bookmark:${anchorNumber}/date`)) break;
    }
    records.push({
      kind: "bookmark",
      url,
      title: plainText(token[3]),
      folder: folders.join("/"),
      tags: attrs
        .get("tags")
        ?.split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      dates:
        added || modified
          ? {
              ...(added ? { added } : {}),
              ...(modified ? { modified } : {}),
            }
          : undefined,
      sourceLocator: `bookmark:${anchorNumber}`,
    });
  }
  return { records, failures };
}

const stringValue = (
  value: Record<string, unknown>,
  keys: string[]
): string | undefined => {
  for (const key of keys) {
    if (typeof value[key] === "string") return value[key] as string;
    if (typeof value[key] === "number") return String(value[key]);
  }
  return undefined;
};

const kindValue = (value: Record<string, unknown>): BrowserExportKind => {
  const raw = stringValue(value, ["kind", "type"])?.toLowerCase();
  if (raw?.includes("history") || raw === "visit") return "history";
  if (raw?.includes("reading") || raw === "read") return "reading-list";
  return "bookmark";
};

const itemRecord = (
  value: Record<string, unknown>,
  locator: string,
  folders: string[]
): BrowserExportRecord | undefined => {
  const url = stringValue(value, ["url", "href", "uri"]);
  if (!url) return undefined;
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === "string")
    : typeof value.tags === "string"
      ? value.tags.split(",").map((tag) => tag.trim())
      : undefined;
  const rawAdded = stringValue(value, ["date_added", "dateAdded", "added"]);
  const rawVisited = stringValue(value, [
    "last_visit_time",
    "lastVisitTime",
    "visited_at",
  ]);
  const rawRead = stringValue(value, ["read_at", "readAt"]);
  const added = exportDate(rawAdded);
  const visited = exportDate(rawVisited);
  const read = exportDate(rawRead);
  if ((rawAdded && !added) || (rawVisited && !visited) || (rawRead && !read)) {
    return undefined;
  }
  const dateEntries: Array<[string, string]> = [];
  if (added) dateEntries.push(["added", added]);
  if (visited) dateEntries.push(["visited", visited]);
  if (read) dateEntries.push(["read", read]);
  return {
    kind: kindValue(value),
    url,
    title: stringValue(value, ["name", "title"]),
    folder: stringValue(value, ["folder", "path"]) ?? folders.join("/"),
    tags,
    dates: dateEntries.length > 0 ? Object.fromEntries(dateEntries) : undefined,
    externalId: stringValue(value, ["id", "guid", "uuid"]),
    sourceLocator: locator,
  };
};

export function parseBrowserJson(
  source: string,
  maxRecords: number,
  maxFailures = 1_000
): BrowserExportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { records: [], failures: ["json"] };
  }
  if (!Array.isArray(parsed) && (!parsed || typeof parsed !== "object")) {
    return { records: [], failures: ["unsupported-json"] };
  }
  if (!Array.isArray(parsed)) {
    const rootKeys = Object.keys(parsed as Record<string, unknown>);
    if (rootKeys.some((key) => SENSITIVE_JSON_KEYS.has(key))) {
      return { records: [], failures: ["sensitive-json"] };
    }
    if (!rootKeys.some((key) => SUPPORTED_JSON_KEYS.has(key))) {
      return { records: [], failures: ["unsupported-json"] };
    }
  }
  const records: BrowserExportRecord[] = [];
  const failures: string[] = [];
  let capReached = false;
  const addFailure = (locator: string): boolean => {
    if (failures.length < maxFailures) failures.push(locator);
    if (failures.length < maxFailures) return false;
    failures.push("failure-limit");
    capReached = true;
    return true;
  };
  const stopAtCap = (locator: string): boolean => {
    if (records.length < maxRecords) return false;
    if (!capReached) addFailure(`${locator}/record-limit`);
    capReached = true;
    return true;
  };
  const visit = (
    value: unknown,
    locator: string,
    folders: string[],
    depth: number
  ): void => {
    if (capReached) return;
    if (depth > MAX_JSON_DEPTH) {
      addFailure(locator);
      return;
    }
    if (Array.isArray(value)) {
      for (const [index, child] of value.entries()) {
        if (stopAtCap(`${locator}/${index}`)) break;
        visit(child, `${locator}/${index}`, folders, depth + 1);
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (Object.keys(object).some((key) => SENSITIVE_JSON_KEYS.has(key))) {
      addFailure(`${locator}/sensitive`);
      return;
    }
    const record = itemRecord(object, locator, folders);
    if (record) {
      if (stopAtCap(locator)) return;
      records.push(record);
    }
    const folderName =
      !record && typeof object.name === "string" ? object.name : undefined;
    const nextFolders = folderName ? [...folders, folderName] : folders;
    const hasSupportedChild = [...SUPPORTED_JSON_KEYS].some(
      (key) => object[key] !== undefined
    );
    if (!record && !hasSupportedChild) {
      addFailure(locator);
      return;
    }
    for (const key of [
      "roots",
      "children",
      "items",
      "bookmarks",
      "history",
      "readingList",
      "reading_list",
    ]) {
      const child = object[key];
      if (child === undefined) continue;
      if (key === "roots" && child && typeof child === "object") {
        for (const [rootName, root] of Object.entries(
          child as Record<string, unknown>
        )) {
          if (capReached) break;
          visit(root, `${locator}/roots/${rootName}`, nextFolders, depth + 1);
        }
      } else {
        visit(child, `${locator}/${key}`, nextFolders, depth + 1);
      }
      if (capReached) break;
    }
  };
  visit(parsed, "json", [], 0);
  return { records, failures };
}
