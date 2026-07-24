import type { Utf8LineResult } from "../shared/utf8-lines";

import {
  cleanTranscriptText,
  parseTranscriptTimestamp,
  type TranscriptParseEvent,
  type TranscriptSegment,
} from "./model";

interface SourceLine {
  lineNumber: number;
  text: string;
}

const VTT_TIMING_PATTERN =
  /^(\d{1,}:\d{2}:\d{2}\.\d{3}|\d{1,2}:\d{2}\.\d{3})\s+-->\s+(\d{1,}:\d{2}:\d{2}\.\d{3}|\d{1,2}:\d{2}\.\d{3})(?:\s+.*)?$/u;
const SRT_TIMING_PATTERN =
  /^(\d{1,}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{1,}:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/u;

const locator = (lines: readonly SourceLine[]): string => {
  const first = lines[0]?.lineNumber ?? 1;
  const last = lines.at(-1)?.lineNumber ?? first;
  return `lines:${first}-${last}`;
};

const malformed = (
  lines: readonly SourceLine[],
  retryable = false
): TranscriptParseEvent => ({
  ok: false,
  sourceLocator: locator(lines),
  retryable,
});

const parseCueBlock = (
  lines: readonly SourceLine[],
  format: "srt" | "vtt"
): TranscriptParseEvent | undefined => {
  if (lines.length === 0) return undefined;
  const first = lines[0]?.text.trim() ?? "";
  if (format === "vtt" && /^(?:NOTE|STYLE|REGION)(?:\s|$)/u.test(first)) {
    return undefined;
  }

  const timingPattern =
    format === "vtt" ? VTT_TIMING_PATTERN : SRT_TIMING_PATTERN;
  let timingIndex = 0;
  let externalId: string | undefined;
  if (!timingPattern.test(first)) {
    if (!lines[1] || !timingPattern.test(lines[1].text.trim())) {
      return malformed(lines);
    }
    externalId = first || undefined;
    timingIndex = 1;
  }
  const timing = timingPattern.exec(lines[timingIndex]?.text.trim() ?? "");
  if (!(timing?.[1] && timing[2])) return malformed(lines);
  const start = parseTranscriptTimestamp(timing[1]);
  const end = parseTranscriptTimestamp(timing[2]);
  if (!(start && end) || end.milliseconds < start.milliseconds) {
    return malformed(lines);
  }
  const payload = lines
    .slice(timingIndex + 1)
    .map((line) => line.text)
    .join("\n");
  const cleaned = cleanTranscriptText(payload);
  if (!cleaned.text) return malformed(lines);
  const firstLine = lines[0]?.lineNumber ?? 1;
  const lastLine = lines.at(-1)?.lineNumber ?? firstLine;
  const segment: TranscriptSegment = {
    externalId,
    text: cleaned.text,
    speaker: cleaned.speaker,
    start: start.text,
    end: end.text,
    sourceLocator: `lines:${firstLine}-${lastLine}`,
    anchorKind: "cue",
    anchorValue: externalId ?? start.text,
    endAnchorValue: end.text,
  };
  return { ok: true, segment };
};

export async function* parseTimedTranscript(
  source: AsyncIterable<Utf8LineResult>,
  format: "srt" | "vtt"
): AsyncGenerator<TranscriptParseEvent> {
  let block: SourceLine[] = [];
  let vttHeaderChecked = format !== "vtt";
  let vttHeaderEnded = format !== "vtt";
  let headerInvalid = false;

  const flush = (): TranscriptParseEvent | undefined => {
    const event = parseCueBlock(block, format);
    block = [];
    return event;
  };

  for await (const line of source) {
    if (!line.ok) {
      const pending = flush();
      if (pending) yield pending;
      yield {
        ok: false,
        sourceLocator: `line:${line.lineNumber}`,
        retryable: !line.terminated,
        tooLarge: line.reason === "line_too_large",
      };
      continue;
    }

    if (!vttHeaderChecked) {
      vttHeaderChecked = true;
      if (!line.text.startsWith("WEBVTT")) {
        headerInvalid = true;
        yield {
          ok: false,
          sourceLocator: `line:${line.lineNumber}`,
          retryable: false,
        };
      }
      continue;
    }
    if (headerInvalid) continue;
    if (!vttHeaderEnded) {
      if (line.text.trim() === "") vttHeaderEnded = true;
      continue;
    }

    if (line.text.trim() === "") {
      const event = flush();
      if (event) yield event;
      continue;
    }
    block.push({ lineNumber: line.lineNumber, text: line.text });
  }
  if (!headerInvalid) {
    const event = flush();
    if (event) yield event;
  }
}
