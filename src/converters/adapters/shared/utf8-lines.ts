export type Utf8LineResult =
  | {
      ok: true;
      lineNumber: number;
      text: string;
      terminated: boolean;
    }
  | {
      ok: false;
      lineNumber: number;
      reason: "invalid_utf8" | "line_too_large";
      terminated: boolean;
    };

const BYTE_LF = 0x0a;
const BYTE_CR = 0x0d;
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

const concatenate = (
  parts: readonly Uint8Array[],
  byteLength: number
): Uint8Array => {
  if (parts.length === 1) return parts[0] ?? new Uint8Array();
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
};

const stripLineEnvelope = (
  bytes: Uint8Array,
  lineNumber: number
): Uint8Array => {
  let start = 0;
  let end = bytes.byteLength;
  if (
    lineNumber === 1 &&
    end >= UTF8_BOM.byteLength &&
    UTF8_BOM.every((byte, index) => bytes[index] === byte)
  ) {
    start = UTF8_BOM.byteLength;
  }
  if (end > start && bytes[end - 1] === BYTE_CR) end -= 1;
  return bytes.subarray(start, end);
};

const decodeLine = (
  parts: readonly Uint8Array[],
  byteLength: number,
  lineNumber: number,
  terminated: boolean
): Utf8LineResult => {
  const bytes = stripLineEnvelope(concatenate(parts, byteLength), lineNumber);
  try {
    return {
      ok: true,
      lineNumber,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      terminated,
    };
  } catch {
    return {
      ok: false,
      lineNumber,
      reason: "invalid_utf8",
      terminated,
    };
  }
};

/**
 * Split an async byte source without retaining an unbounded physical line.
 * Invalid UTF-8 and oversized lines are isolated so later siblings can proceed.
 */
export async function* readBoundedUtf8Lines(
  source: AsyncIterable<Uint8Array>,
  maxLineBytes: number
): AsyncGenerator<Utf8LineResult> {
  const safeMaxLineBytes = Math.max(1, Math.floor(maxLineBytes));
  let parts: Uint8Array[] = [];
  let lineBytes = 0;
  let lineNumber = 1;
  let oversized = false;

  const reset = (): void => {
    parts = [];
    lineBytes = 0;
    oversized = false;
    lineNumber += 1;
  };

  for await (const chunk of source) {
    let segmentStart = 0;
    for (let index = 0; index < chunk.byteLength; index += 1) {
      if (chunk[index] !== BYTE_LF) continue;
      const segment = chunk.subarray(segmentStart, index);
      if (!oversized && lineBytes + segment.byteLength <= safeMaxLineBytes) {
        if (segment.byteLength > 0) parts.push(segment.slice());
        lineBytes += segment.byteLength;
      } else {
        oversized = true;
      }
      if (oversized) {
        yield {
          ok: false,
          lineNumber,
          reason: "line_too_large",
          terminated: true,
        };
      } else {
        yield decodeLine(parts, lineBytes, lineNumber, true);
      }
      reset();
      segmentStart = index + 1;
    }

    const remainder = chunk.subarray(segmentStart);
    if (!oversized && lineBytes + remainder.byteLength <= safeMaxLineBytes) {
      if (remainder.byteLength > 0) parts.push(remainder.slice());
      lineBytes += remainder.byteLength;
    } else if (remainder.byteLength > 0) {
      oversized = true;
      parts = [];
      lineBytes = 0;
    }
  }

  if (oversized) {
    yield {
      ok: false,
      lineNumber,
      reason: "line_too_large",
      terminated: false,
    };
  } else if (lineBytes > 0) {
    yield decodeLine(parts, lineBytes, lineNumber, false);
  }
}
