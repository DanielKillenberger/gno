import type {
  RecordAdapter,
  RecordAdapterFailure,
  RecordAdapterFailureCode,
  RecordAdapterInput,
  RecordAdapterRecord,
  RecordAnchor,
  RecordMetadata,
} from "../converters/types";

import { canonicalize, mirrorHash } from "../converters/canonicalize";

const HASH_PATTERN = /^[a-f\d]{64}$/;
const CONTROL_PATTERN = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`
);
const WINDOWS_ABSOLUTE_PATTERN = /^[a-zA-Z]:[\\/]/;
const MAX_ID_CHARS = 512;
const MAX_LOCATOR_CHARS = 512;
const MAX_ERROR_CHARS = 240;

export interface CanonicalRecord {
  recordKey: string;
  stableId: string;
  sourceLocator: string;
  sourceHash: string;
  mirrorHash: string;
  markdown: string;
  adapterId: string;
  adapterVersion: string;
  title?: string;
  languageHint?: string;
  metadata?: RecordMetadata;
  anchors?: RecordAnchor[];
}

export interface AccountedCanonicalRecord extends CanonicalRecord {
  accountingChars: number;
  metadataChars: number;
}

const hashText = (value: string): string => {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
};

const canonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = canonicalJsonValue((value as Record<string, unknown>)[key]);
      if (child !== undefined) result[key] = child;
    }
    return result;
  }
  return value;
};

const normalizeText = (value: string): string => value.normalize("NFC").trim();

const normalizeStableId = (value: string): string => {
  const normalized = normalizeText(value);
  if (
    normalized.length === 0 ||
    normalized.length > MAX_ID_CHARS ||
    CONTROL_PATTERN.test(normalized) ||
    normalized.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATTERN.test(normalized)
  ) {
    throw new Error("invalid stable ID");
  }
  return normalized;
};

const normalizeLocator = (value: string): string => {
  const normalized = normalizeText(value);
  const pathSegments = normalized.replaceAll("\\", "/").split("/");
  if (
    normalized.length === 0 ||
    normalized.length > MAX_LOCATOR_CHARS ||
    CONTROL_PATTERN.test(normalized) ||
    normalized.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATTERN.test(normalized) ||
    pathSegments.includes("..")
  ) {
    throw new Error("invalid source locator");
  }
  return normalized;
};

const normalizeOptionalText = (
  value: string | undefined
): string | undefined => {
  if (value === undefined) return undefined;
  const normalized = normalizeText(value).replace(CONTROL_PATTERN, "");
  return normalized || undefined;
};

const normalizeFailureReference = (
  value: string | undefined
): string | undefined => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return undefined;
  const pathSegments = normalized.replaceAll("\\", "/").split("/");
  if (
    normalized.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATTERN.test(normalized) ||
    pathSegments.includes("..")
  ) {
    return undefined;
  }
  return normalized.slice(0, MAX_LOCATOR_CHARS);
};

const normalizeMetadata = (
  metadata: RecordMetadata | undefined
): RecordMetadata | undefined => {
  if (!metadata) return undefined;
  const normalizeList = (
    values: string[] | undefined
  ): string[] | undefined => {
    if (!values) return undefined;
    return values
      .map((value) => normalizeOptionalText(value))
      .filter((value): value is string => Boolean(value));
  };
  const dateFields = metadata.dateFields
    ? Object.fromEntries(
        Object.entries(metadata.dateFields)
          .map(([key, value]) => [
            normalizeOptionalText(key),
            normalizeOptionalText(value),
          ])
          .filter(
            (entry): entry is [string, string] =>
              Boolean(entry[0]) && Boolean(entry[1])
          )
          .sort(([left], [right]) => left.localeCompare(right))
      )
    : undefined;
  return {
    author: normalizeOptionalText(metadata.author),
    participants: normalizeList(metadata.participants),
    categories: normalizeList(metadata.categories),
    dateFields,
    threadId: normalizeOptionalText(metadata.threadId),
    eventId: normalizeOptionalText(metadata.eventId),
    sessionId: normalizeOptionalText(metadata.sessionId),
    attachments: metadata.attachments?.map((attachment) => ({
      name: normalizeOptionalText(attachment.name) ?? "attachment",
      mime: normalizeOptionalText(attachment.mime),
      bytes:
        attachment.bytes !== undefined &&
        Number.isSafeInteger(attachment.bytes) &&
        attachment.bytes >= 0
          ? attachment.bytes
          : undefined,
      disposition: attachment.disposition,
    })),
  };
};

const normalizeAnchors = (
  anchors: RecordAnchor[] | undefined
): RecordAnchor[] | undefined =>
  anchors?.map((anchor) => ({
    kind: anchor.kind,
    value: normalizeOptionalText(anchor.value) ?? "unknown",
    endValue: normalizeOptionalText(anchor.endValue),
  }));

export const recordKeyFor = (adapterId: string, stableId: string): string =>
  hashText(`gno-record-v1\0${adapterId}\0${normalizeStableId(stableId)}`);

export const safeFailure = (
  input: RecordAdapterInput,
  code: RecordAdapterFailureCode,
  message: string,
  retryable: boolean,
  stableId?: string,
  sourceLocator?: string
): RecordAdapterFailure => {
  const withoutPath = message.replaceAll(input.sourcePath, "<source>");
  const sanitized = withoutPath
    .replace(CONTROL_PATTERN, " ")
    .slice(0, MAX_ERROR_CHARS);
  return {
    code,
    message: sanitized || "Record adapter failure.",
    retryable,
    stableId: normalizeFailureReference(stableId),
    sourceLocator: normalizeFailureReference(sourceLocator),
  };
};

export const canonicalRecord = (
  adapter: RecordAdapter,
  record: RecordAdapterRecord
): AccountedCanonicalRecord => {
  const stableId = normalizeStableId(record.stableId);
  const sourceLocator = normalizeLocator(record.sourceLocator);
  const markdown = canonicalize(record.markdown);
  const metadata = normalizeMetadata(record.metadata);
  const anchors = normalizeAnchors(record.anchors);
  const title = normalizeOptionalText(record.title);
  const languageHint = normalizeOptionalText(record.languageHint);
  const derivedSource = JSON.stringify(
    canonicalJsonValue({
      anchors,
      languageHint,
      markdown,
      metadata,
      sourceLocator,
      stableId,
      title,
    })
  );
  const metadataChars = JSON.stringify(
    canonicalJsonValue({
      anchors,
      languageHint,
      metadata,
      sourceLocator,
      stableId,
      title,
    })
  ).length;
  if (
    record.sourceHash !== undefined &&
    !HASH_PATTERN.test(record.sourceHash)
  ) {
    throw new Error("invalid source hash");
  }
  return {
    recordKey: recordKeyFor(adapter.id, stableId),
    stableId,
    sourceLocator,
    sourceHash:
      record.sourceHash ?? hashText(`gno-record-source-v1\0${derivedSource}`),
    mirrorHash: mirrorHash(markdown),
    markdown,
    adapterId: adapter.id,
    adapterVersion: adapter.version,
    title,
    languageHint,
    metadata,
    anchors,
    accountingChars: derivedSource.length,
    metadataChars,
  };
};

export const adapterFailureMessage = (
  code: RecordAdapterFailureCode
): string => {
  switch (code) {
    case "MALFORMED_RECORD":
      return "Record adapter reported a malformed record.";
    case "MISSING_ID":
      return "Record adapter reported a missing stable identity.";
    case "DUPLICATE_ID":
      return "Record adapter reported a duplicate stable identity.";
    case "RECORD_TOO_LARGE":
      return "Record adapter reported an oversized record.";
    case "SOURCE_TOO_LARGE":
      return "Record adapter reported an oversized source.";
    case "RECORD_LIMIT":
      return "Record adapter reported that its record limit was reached.";
    case "FAILURE_LIMIT":
      return "Record adapter reported that its failure limit was reached.";
    case "INVALID_LOCATOR":
      return "Record adapter reported an invalid source locator.";
    case "INVALID_SOURCE_HASH":
      return "Record adapter reported an invalid source hash.";
    case "INVALID_SNAPSHOT":
      return "Record adapter reported an invalid snapshot.";
    default:
      return "Record adapter reported a conversion failure.";
  }
};
