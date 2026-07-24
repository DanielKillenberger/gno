import type { RecordAdapterInput } from "../../types";

const CONTROL_PATTERN = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g"
);

export const hashRecordValue = (domain: string, value: string): string => {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${domain}\0${value}`);
  return hasher.digest("hex");
};

export const canonicalJson = (value: unknown): string => {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, normalize(record[key])])
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
};

export const safeMarkdownText = (value: string): string =>
  value
    .normalize("NFC")
    .replace(CONTROL_PATTERN, "")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const safeInlineText = (value: string): string =>
  safeMarkdownText(value).replaceAll(/\s+/g, " ").trim();

export const sourceNamespace = (input: RecordAdapterInput): string =>
  hashRecordValue(
    "gno-record-container-v1",
    canonicalJson({
      collection: input.collection.normalize("NFC"),
      relativePath: input.relativePath.replaceAll("\\", "/").normalize("NFC"),
    })
  );

export const adapterLineByteLimit = (input: RecordAdapterInput): number => {
  const characterBudget =
    input.limits.maxRecordChars + input.limits.maxMetadataChars;
  const utf8Budget = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(1, characterBudget) * 4
  );
  return Math.max(1, Math.min(input.limits.maxSourceBytes, utf8Budget));
};

export const scalarText = (value: unknown): string | undefined => {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return undefined;
  }
  const text = String(value).normalize("NFC").trim();
  return text || undefined;
};

export const scalarList = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  const candidates = Array.isArray(value) ? value : [value];
  const result = candidates
    .map(scalarText)
    .filter((item): item is string => Boolean(item));
  return result.length > 0 ? result : undefined;
};
