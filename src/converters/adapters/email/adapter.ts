import type {
  RecordAdapter,
  RecordAdapterEvent,
  RecordAdapterInput,
  RecordAdapterRecord,
} from "../../types";

import { type ParsedAttachment, type ParsedEmail, parseEmail } from "./mime";

const ADAPTER_ID = "native/email-export";
const ADAPTER_VERSION = "1.0.0";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const BINARY_STRING_CHUNK = 8_192;
const CONTROL_CHAR_PATTERN = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g"
);

interface RawMessage {
  raw?: string;
  index: number;
  oversized: boolean;
}

interface BinaryLine {
  value?: string;
  oversized: boolean;
}

const hashText = (value: string): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

const bytesToBinary = (bytes: Uint8Array): string => {
  const pieces: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BINARY_STRING_CHUNK) {
    pieces.push(
      String.fromCharCode(
        ...bytes.subarray(
          offset,
          Math.min(offset + BINARY_STRING_CHUNK, bytes.length)
        )
      )
    );
  }
  return pieces.join("");
};

const rawMessageLimit = (input: RecordAdapterInput): number => {
  const attachmentLimit = Math.max(
    1_024,
    Math.min(MAX_ATTACHMENT_BYTES, input.limits.maxRecordChars * 2)
  );
  const desired = Math.max(
    input.limits.maxRecordChars * 4,
    input.limits.maxMetadataChars * 4,
    attachmentLimit * 2
  );
  return Math.max(4_096, Math.min(input.limits.maxSourceBytes, desired));
};

async function* binaryLines(
  input: RecordAdapterInput,
  maxLineChars: number
): AsyncGenerator<BinaryLine> {
  let pending = "";
  let oversized = false;
  for await (const chunk of input.open()) {
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      if (!oversized) {
        const segment = bytesToBinary(chunk.subarray(start, index));
        if (pending.length + segment.length > maxLineChars) {
          oversized = true;
          pending = "";
        } else {
          pending += segment;
        }
      }
      yield oversized
        ? { oversized: true }
        : { value: pending.replace(/\r$/, ""), oversized: false };
      pending = "";
      oversized = false;
      start = index + 1;
    }
    if (start < chunk.length && !oversized) {
      const segment = bytesToBinary(chunk.subarray(start));
      if (pending.length + segment.length > maxLineChars) {
        oversized = true;
        pending = "";
      } else {
        pending += segment;
      }
    }
  }
  if (pending || oversized) {
    yield oversized
      ? { oversized: true }
      : { value: pending.replace(/\r$/, ""), oversized: false };
  }
}

const readEml = async (
  input: RecordAdapterInput,
  maxChars: number
): Promise<RawMessage> => {
  const pieces: string[] = [];
  let chars = 0;
  for await (const chunk of input.open()) {
    chars += chunk.length;
    if (chars > maxChars) return { index: 1, oversized: true };
    pieces.push(bytesToBinary(chunk));
  }
  return { raw: pieces.join(""), index: 1, oversized: false };
};

async function* readMbox(
  input: RecordAdapterInput,
  maxChars: number
): AsyncGenerator<RawMessage> {
  let messageParts: string[] = [];
  let messageChars = 0;
  let messageIndex = 0;
  let oversized = false;
  let sawEnvelope = false;

  const finishMessage = (): RawMessage | undefined => {
    if (messageParts.length === 0 && !oversized) return undefined;
    messageIndex += 1;
    const result: RawMessage = {
      raw: oversized ? undefined : messageParts.join("\n"),
      index: messageIndex,
      oversized,
    };
    messageParts = [];
    messageChars = 0;
    oversized = false;
    return result;
  };

  for await (const line of binaryLines(input, maxChars)) {
    const isEnvelope = !line.oversized && line.value?.startsWith("From ");
    if (isEnvelope) {
      const finished = finishMessage();
      if (finished) yield finished;
      sawEnvelope = true;
      continue;
    }
    if (!sawEnvelope && messageParts.length === 0 && line.value === "") {
      continue;
    }
    if (line.oversized) {
      oversized = true;
      messageParts = [];
      continue;
    }
    if (oversized) continue;
    const lineValue = line.value ?? "";
    messageChars += lineValue.length + 1;
    if (messageChars > maxChars) {
      oversized = true;
      messageParts = [];
    } else {
      messageParts.push(lineValue);
    }
  }
  const finished = finishMessage();
  if (finished) yield finished;
}

const markdownInline = (value: string): string =>
  value
    .replace(CONTROL_CHAR_PATTERN, " ")
    .replace(/([\\`*_[\]<>#])/g, "\\$1")
    .replace(/\s+/g, " ")
    .trim();

const safeBodyMarkdown = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replace(/([`*_[\]<>])/g, "\\$1")
    .replace(/\r/g, "");

const renderAttachments = (attachments: ParsedAttachment[]): string => {
  if (attachments.length === 0) return "";
  const lines = attachments.map(
    (attachment) =>
      `- ${markdownInline(attachment.name)} — ${markdownInline(
        attachment.mime ?? "application/octet-stream"
      )} — ${attachment.bytes ?? 0} bytes — sha256:${attachment.sha256}`
  );
  return `\n\n## Attachments\n\n${lines.join("\n")}`;
};

const renderEmail = (
  parsed: ParsedEmail,
  occurrence: number,
  missingId: boolean
): string => {
  const title = markdownInline(parsed.subject ?? "(no subject)");
  const fields = [
    parsed.author ? `From: ${markdownInline(parsed.author)}` : undefined,
    parsed.participants.length > 1
      ? `Participants: ${parsed.participants.map(markdownInline).join("; ")}`
      : undefined,
    parsed.sentAt ? `Date: ${parsed.sentAt}` : undefined,
    parsed.messageId
      ? `Message-ID: ${markdownInline(parsed.messageId)}`
      : "Message-ID: missing",
    parsed.inReplyTo
      ? `In-Reply-To: ${markdownInline(parsed.inReplyTo)}`
      : undefined,
    parsed.references.length > 0
      ? `References: ${parsed.references.map(markdownInline).join("; ")}`
      : undefined,
    `Occurrence: ${occurrence}${missingId ? " (content-derived identity)" : ""}`,
  ].filter((value): value is string => Boolean(value));
  const body = parsed.body
    ? safeBodyMarkdown(parsed.body)
    : "(No safe text body.)";
  return `# ${title}\n\n${fields.join("\n")}\n\n${body}${renderAttachments(
    parsed.attachments
  )}`;
};

const recordFor = (
  parsed: ParsedEmail,
  raw: string,
  index: number,
  identityCounts: Map<string, number>
): RecordAdapterRecord => {
  const canonicalRaw = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const sourceHash = hashText(`gno-email-source-v1\0${canonicalRaw}`);
  const identity = parsed.messageId
    ? `message:${hashText(parsed.messageId)}`
    : `missing:${sourceHash}`;
  const occurrence = (identityCounts.get(identity) ?? 0) + 1;
  identityCounts.set(identity, occurrence);
  return {
    stableId:
      occurrence === 1 ? identity : `${identity}:occurrence:${occurrence}`,
    sourceLocator: `message:${index}`,
    sourceHash,
    markdown: renderEmail(parsed, occurrence, !parsed.messageId),
    title: parsed.subject,
    metadata: parsed.metadata,
    anchors: [
      {
        kind: "message",
        value: parsed.messageId ?? `message:${index}`,
      },
    ],
  };
};

const parseLimits = (input: RecordAdapterInput) => ({
  maxBodyChars: input.limits.maxRecordChars,
  maxMetadataChars: input.limits.maxMetadataChars,
  maxAttachmentBytes: Math.max(
    1_024,
    Math.min(MAX_ATTACHMENT_BYTES, input.limits.maxRecordChars * 2)
  ),
});

const failure = (
  index: number,
  code: "MALFORMED_RECORD" | "RECORD_TOO_LARGE"
): RecordAdapterEvent => ({
  type: "failure",
  failure: {
    code,
    message:
      code === "RECORD_TOO_LARGE"
        ? "Mail message exceeded its bounded parse limit."
        : "Mail message could not be parsed safely.",
    retryable: false,
    sourceLocator: `message:${index}`,
  },
});

export const emailRecordAdapter: RecordAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  canHandle(mime, ext) {
    const normalizedMime = mime.toLowerCase();
    const normalizedExt = ext.toLowerCase();
    return (
      normalizedExt === ".eml" ||
      normalizedExt === ".mbox" ||
      normalizedMime === "message/rfc822" ||
      normalizedMime === "application/mbox"
    );
  },

  async *records(input) {
    const isMbox =
      input.ext.toLowerCase() === ".mbox" ||
      input.mime.toLowerCase() === "application/mbox";
    const messages: AsyncIterable<RawMessage> = isMbox
      ? readMbox(input, rawMessageLimit(input))
      : {
          async *[Symbol.asyncIterator]() {
            yield await readEml(input, rawMessageLimit(input));
          },
        };
    const identityCounts = new Map<string, number>();
    let partial = false;
    let messageCount = 0;
    for await (const message of messages) {
      messageCount += 1;
      if (message.oversized || message.raw === undefined) {
        partial = true;
        yield failure(message.index, "RECORD_TOO_LARGE");
        continue;
      }
      try {
        const parsed = parseEmail(message.raw, parseLimits(input));
        yield {
          type: "record",
          record: recordFor(parsed, message.raw, message.index, identityCounts),
        };
      } catch {
        partial = true;
        yield failure(message.index, "MALFORMED_RECORD");
      }
    }
    if (messageCount === 0) {
      partial = true;
      yield failure(1, "MALFORMED_RECORD");
    }
    yield { type: "snapshot", state: partial ? "partial" : "complete" };
  },
};
