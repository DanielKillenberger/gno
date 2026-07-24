import type { Utf8LineResult } from "../shared/utf8-lines";

import {
  cleanTranscriptText,
  parseTranscriptTimestamp,
  type TranscriptParseEvent,
  type TranscriptSegment,
} from "./model";

const TIMESTAMP_PREFIX = /^\[([^\]]{1,32})\]\s*(.*)$/su;

export async function* parseTextTranscript(
  source: AsyncIterable<Utf8LineResult>
): AsyncGenerator<TranscriptParseEvent> {
  for await (const line of source) {
    if (!line.ok) {
      yield {
        ok: false,
        sourceLocator: `line:${line.lineNumber}`,
        retryable: !line.terminated,
        tooLarge: line.reason === "line_too_large",
      };
      continue;
    }
    const raw = line.text.trim();
    if (!raw) continue;
    const timestampPrefix = TIMESTAMP_PREFIX.exec(raw);
    const timestamp = timestampPrefix
      ? parseTranscriptTimestamp(timestampPrefix[1])
      : undefined;
    if (timestampPrefix && !timestamp) {
      yield {
        ok: false,
        sourceLocator: `line:${line.lineNumber}`,
        retryable: false,
      };
      continue;
    }
    const cleaned = cleanTranscriptText(timestampPrefix?.[2] ?? raw);
    if (!cleaned.text) {
      yield {
        ok: false,
        sourceLocator: `line:${line.lineNumber}`,
        retryable: false,
      };
      continue;
    }
    const segment: TranscriptSegment = {
      text: cleaned.text,
      speaker: cleaned.speaker,
      start: timestamp?.text,
      sourceLocator: `line:${line.lineNumber}`,
      anchorKind: "line",
      anchorValue: String(line.lineNumber),
    };
    yield { ok: true, segment };
  }
}
