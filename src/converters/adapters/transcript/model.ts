import {
  decodeHtmlEntitiesOnce,
  htmlFragmentToText,
} from "../shared/html-text";
import {
  safeInlineText,
  safeMarkdownText,
  scalarText,
} from "../shared/record-utils";

export type TranscriptFormat = "auto" | "json" | "srt" | "text" | "vtt";

export interface TranscriptAdapterOptions {
  /** Generic JSON and text sources require explicit selection at registration. */
  format?: TranscriptFormat;
}

export interface TranscriptSegment {
  externalId?: string;
  text: string;
  speaker?: string;
  start?: string;
  end?: string;
  sourceLocator: string;
  anchorKind: "cue" | "line" | "record";
  anchorValue: string;
  endAnchorValue?: string;
  sessionId?: string;
  sessionTitle?: string;
  participants?: string[];
  dateFields?: Record<string, string>;
}

export type TranscriptParseEvent =
  | { ok: true; segment: TranscriptSegment }
  | {
      ok: false;
      sourceLocator?: string;
      retryable: boolean;
      tooLarge?: boolean;
    };

const TIMESTAMP_PATTERN = /^(?:(\d{1,}):)?([0-5]?\d):([0-5]\d)[,.](\d{3})$/;

export const parseTranscriptTimestamp = (
  value: unknown
): { text: string; milliseconds: number } | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const milliseconds = Math.round(value * 1_000);
    if (Number.isSafeInteger(milliseconds)) {
      return { text: formatTranscriptTimestamp(milliseconds), milliseconds };
    }
    return undefined;
  }
  const scalar = scalarText(value);
  if (!scalar) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(scalar)) {
    const milliseconds = Math.round(Number(scalar) * 1_000);
    if (Number.isSafeInteger(milliseconds)) {
      return { text: formatTranscriptTimestamp(milliseconds), milliseconds };
    }
  }
  const match = TIMESTAMP_PATTERN.exec(scalar);
  if (!match) return undefined;
  const hours = Number(match[1] ?? "0");
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millisecondsPart = Number(match[4]);
  const milliseconds =
    (hours * 60 * 60 + minutes * 60 + seconds) * 1_000 + millisecondsPart;
  if (!Number.isSafeInteger(milliseconds)) return undefined;
  return { text: formatTranscriptTimestamp(milliseconds), milliseconds };
};

export const formatTranscriptTimestamp = (milliseconds: number): string => {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
};

const VALID_TRANSCRIPT_FORMATS = new Set<TranscriptFormat>([
  "auto",
  "json",
  "srt",
  "text",
  "vtt",
]);

export const parseTranscriptAdapterOptions = (
  options: TranscriptAdapterOptions
): Required<TranscriptAdapterOptions> => {
  const format = options.format ?? "auto";
  if (!VALID_TRANSCRIPT_FORMATS.has(format)) {
    throw new Error("Unsupported transcript adapter format.");
  }
  return { format };
};

const vttVoiceSpeaker = (value: string): string | undefined => {
  const source = value.trimStart();
  if (
    source.length < 3 ||
    source[0] !== "<" ||
    source[1]?.toLowerCase() !== "v"
  )
    return undefined;
  const end = source.indexOf(">", 2);
  if (end < 0) return undefined;
  let cursor = 2;
  if (source[cursor] === ".") {
    while (
      cursor < end &&
      source[cursor] !== " " &&
      source[cursor] !== "\t" &&
      source[cursor] !== "\n" &&
      source[cursor] !== "\r"
    )
      cursor += 1;
  }
  if (
    source[cursor] !== " " &&
    source[cursor] !== "\t" &&
    source[cursor] !== "\n" &&
    source[cursor] !== "\r"
  )
    return undefined;
  while (
    cursor < end &&
    (source[cursor] === " " ||
      source[cursor] === "\t" ||
      source[cursor] === "\n" ||
      source[cursor] === "\r")
  )
    cursor += 1;
  const speaker = source.slice(cursor, end).trim();
  if (!speaker || speaker.length > 80) return undefined;
  return safeInlineText(decodeHtmlEntitiesOnce(speaker));
};

const speakerPrefix = (
  value: string
): { speaker: string; text: string } | undefined => {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator > 80) return undefined;
  const speaker = value.slice(0, separator);
  if (speaker.includes("\n")) return undefined;
  const remainder = value.slice(separator + 1);
  if (
    remainder.length === 0 ||
    (remainder[0] !== " " &&
      remainder[0] !== "\t" &&
      remainder[0] !== "\n" &&
      remainder[0] !== "\r")
  )
    return undefined;
  const text = remainder.trim();
  if (!text) return undefined;
  return { speaker: safeInlineText(speaker), text };
};

export const cleanTranscriptText = (
  value: string
): { text: string; speaker?: string } => {
  const speaker = vttVoiceSpeaker(value);
  const cleaned = safeMarkdownText(htmlFragmentToText(value)).trim();
  if (speaker) return { text: cleaned, speaker };
  return speakerPrefix(cleaned) ?? { text: cleaned };
};
