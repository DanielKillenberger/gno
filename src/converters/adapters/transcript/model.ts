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
const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script\s*>/giu;
const STYLE_BLOCK_PATTERN = /<style\b[^>]*>[\s\S]*?<\/style\s*>/giu;
const HTML_TAG_PATTERN = /<[^>]*>/gu;
const SPEAKER_PREFIX_PATTERN = /^([^:\n]{1,80}):\s+(.+)$/su;
const VTT_VOICE_PATTERN = /^<v(?:\.[^ >]+)*\s+([^>]{1,80})>/iu;

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

const decodeEntities = (value: string): string =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

export const cleanTranscriptText = (
  value: string
): { text: string; speaker?: string } => {
  let speaker: string | undefined;
  const voice = VTT_VOICE_PATTERN.exec(value.trimStart());
  if (voice?.[1]) speaker = safeInlineText(voice[1]);
  const withoutUnsafeBlocks = value
    .replace(SCRIPT_BLOCK_PATTERN, "")
    .replace(STYLE_BLOCK_PATTERN, "")
    .replaceAll(/<br\s*\/?>/giu, "\n")
    .replace(HTML_TAG_PATTERN, "");
  const cleaned = safeMarkdownText(decodeEntities(withoutUnsafeBlocks)).trim();
  if (speaker) return { text: cleaned, speaker };
  const prefixed = SPEAKER_PREFIX_PATTERN.exec(cleaned);
  if (!prefixed?.[1] || !prefixed[2]) return { text: cleaned };
  return {
    speaker: safeInlineText(prefixed[1]),
    text: prefixed[2].trim(),
  };
};
