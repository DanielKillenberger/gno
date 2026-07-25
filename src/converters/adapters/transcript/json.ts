import { scalarList, scalarText } from "../shared/record-utils";
import {
  cleanTranscriptText,
  parseTranscriptTimestamp,
  type TranscriptParseEvent,
  type TranscriptSegment,
} from "./model";

const ownValue = (
  record: Record<string, unknown>,
  names: readonly string[]
): unknown => {
  for (const name of names) {
    if (Object.hasOwn(record, name)) return record[name];
  }
  return undefined;
};

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const personText = (value: unknown): string | undefined => {
  const scalar = scalarText(value);
  if (scalar) return scalar;
  const object = objectValue(value);
  return object
    ? scalarText(ownValue(object, ["name", "displayName", "label", "id"]))
    : undefined;
};

const peopleList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return scalarList(value);
  const people = value
    .map(personText)
    .filter((person): person is string => Boolean(person));
  return people.length > 0 ? people : undefined;
};

const segmentArray = (
  root: unknown
):
  | {
      segments: unknown[];
      pointerName: string;
      session: Record<string, unknown>;
    }
  | undefined => {
  if (Array.isArray(root)) {
    return { segments: root, pointerName: "", session: {} };
  }
  const rootObject = objectValue(root);
  if (!rootObject) return undefined;
  const nested = objectValue(ownValue(rootObject, ["transcript"]));
  const session = nested ?? rootObject;
  for (const name of ["segments", "utterances", "items"] as const) {
    const value = ownValue(session, [name]);
    if (Array.isArray(value)) {
      return {
        segments: value,
        pointerName: nested ? `transcript/${name}` : name,
        session,
      };
    }
  }
  return undefined;
};

const sessionDateFields = (
  session: Record<string, unknown>
): Record<string, string> | undefined => {
  const fields: Record<string, string> = {};
  for (const [name, aliases] of [
    ["recorded", ["recordedAt", "recorded_at", "date"]],
    ["created", ["createdAt", "created_at"]],
  ] as const) {
    const value = scalarText(ownValue(session, aliases));
    if (value) fields[name] = value;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
};

export function* parseJsonTranscript(
  text: string
): Generator<TranscriptParseEvent> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const finalCharacter = text.trimEnd().at(-1);
    yield {
      ok: false,
      retryable: finalCharacter !== "}" && finalCharacter !== "]",
    };
    return;
  }
  const container = segmentArray(parsed);
  if (!container) {
    yield { ok: false, retryable: false };
    return;
  }

  const sessionId = scalarText(
    ownValue(container.session, ["sessionId", "session_id", "id"])
  );
  const sessionTitle = scalarText(
    ownValue(container.session, ["title", "name"])
  );
  const participants = peopleList(
    ownValue(container.session, ["participants", "speakers"])
  );
  const dateFields = sessionDateFields(container.session);

  for (const [index, candidate] of container.segments.entries()) {
    const pointer = `/${container.pointerName ? `${container.pointerName}/` : ""}${index}`;
    const sourceLocator = `record:${pointer.slice(1) || index}`;
    const record = objectValue(candidate);
    if (!record) {
      yield { ok: false, sourceLocator, retryable: false };
      continue;
    }
    const rawText = scalarText(
      ownValue(record, ["text", "content", "transcript"])
    );
    if (!rawText) {
      yield { ok: false, sourceLocator, retryable: false };
      continue;
    }
    const cleaned = cleanTranscriptText(rawText);
    if (!cleaned.text) {
      yield { ok: false, sourceLocator, retryable: false };
      continue;
    }

    const rawStart = ownValue(record, [
      "start",
      "startTime",
      "start_time",
      "startSeconds",
    ]);
    const rawEnd = ownValue(record, [
      "end",
      "endTime",
      "end_time",
      "endSeconds",
    ]);
    const start =
      rawStart === undefined ? undefined : parseTranscriptTimestamp(rawStart);
    const end =
      rawEnd === undefined ? undefined : parseTranscriptTimestamp(rawEnd);
    if (
      (rawStart !== undefined && !start) ||
      (rawEnd !== undefined && !end) ||
      (start && end && end.milliseconds < start.milliseconds)
    ) {
      yield { ok: false, sourceLocator, retryable: false };
      continue;
    }

    const speaker =
      personText(
        ownValue(record, ["speaker", "speakerName", "speaker_name", "author"])
      ) ?? cleaned.speaker;
    const externalId = scalarText(
      ownValue(record, ["id", "segmentId", "segment_id", "utteranceId"])
    );
    const segment: TranscriptSegment = {
      externalId,
      text: cleaned.text,
      speaker,
      start: start?.text,
      end: end?.text,
      sourceLocator,
      anchorKind: "record",
      anchorValue: pointer,
      sessionId,
      sessionTitle,
      participants,
      dateFields,
    };
    yield { ok: true, segment };
  }
}
