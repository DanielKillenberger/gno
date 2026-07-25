const BASIC_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;
const BASIC_DATE_TIME_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

export const MAX_RECURRENCE_ANCHORS = 64;
const MAX_RECURRENCE_HORIZON_DAYS = 366;

export interface RecurrenceSummary {
  recurrenceId?: string;
  rrule?: string;
  exdates: string[];
  rdates: string[];
  occurrenceAnchors: string[];
  truncated: boolean;
}

export interface IcalPropertyLike {
  name: string;
  value: string;
  params?: ReadonlyMap<string, string>;
}

interface BasicDateParts {
  date: Date;
  dateOnly: boolean;
  utc: boolean;
}

const parseBasicDate = (value: string): BasicDateParts | undefined => {
  const dateOnly = BASIC_DATE_PATTERN.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const date = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0)
    );
    return { date, dateOnly: true, utc: false };
  }
  const dateTime = BASIC_DATE_TIME_PATTERN.exec(value);
  if (!dateTime) return undefined;
  const [, year, month, day, hour, minute, second, utc] = dateTime;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
  );
  return { date, dateOnly: false, utc: Boolean(utc) };
};

const pad = (value: number): string => value.toString().padStart(2, "0");

const formatBasicDate = (parts: BasicDateParts, date: Date): string => {
  const datePart = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  if (parts.dateOnly) return datePart;
  const timePart = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `${datePart}T${timePart}${parts.utc ? "Z" : ""}`;
};

const parseRule = (value: string): Map<string, string> | undefined => {
  const rule = new Map<string, string>();
  for (const part of value.split(";")) {
    const equals = part.indexOf("=");
    if (equals <= 0 || equals === part.length - 1) return undefined;
    const key = part.slice(0, equals).toUpperCase();
    const item = part.slice(equals + 1);
    if (!/^[A-Z-]+$/.test(key) || rule.has(key)) return undefined;
    rule.set(key, item);
  }
  return rule.size > 0 ? rule : undefined;
};

const recurrenceAnchor = (value: string, timezone?: string): string =>
  timezone ? `TZID=${timezone}:${value}` : value;

const expandSimpleRule = (
  start: string,
  ruleValue: string,
  exclusions: Set<string>,
  limit: number,
  timezone?: string
): { anchors: string[]; truncated: boolean } => {
  const startParts = parseBasicDate(start);
  if (!startParts) return { anchors: [], truncated: true };
  const rule = parseRule(ruleValue);
  if (!rule) return { anchors: [], truncated: true };
  const supportedKeys = new Set(["FREQ", "COUNT", "INTERVAL"]);
  if ([...rule.keys()].some((key) => !supportedKeys.has(key))) {
    return { anchors: [], truncated: true };
  }
  const frequency = rule.get("FREQ");
  if (frequency !== "DAILY" && frequency !== "WEEKLY") {
    return { anchors: [], truncated: true };
  }
  const configuredCount = rule.get("COUNT");
  const countValue = Number(configuredCount ?? limit);
  const intervalValue = Number(rule.get("INTERVAL") ?? 1);
  if (
    !Number.isSafeInteger(countValue) ||
    countValue < 1 ||
    !Number.isSafeInteger(intervalValue) ||
    intervalValue < 1
  ) {
    return { anchors: [], truncated: true };
  }
  const stepDays = frequency === "WEEKLY" ? intervalValue * 7 : intervalValue;
  const requested = Math.min(countValue, limit + 1);
  const anchors: string[] = [];
  for (let index = 0; index < requested; index += 1) {
    const elapsedDays = index * stepDays;
    if (elapsedDays > MAX_RECURRENCE_HORIZON_DAYS) {
      return { anchors, truncated: true };
    }
    const occurrence = new Date(startParts.date);
    occurrence.setUTCDate(occurrence.getUTCDate() + elapsedDays);
    const formatted = formatBasicDate(startParts, occurrence);
    if (!exclusions.has(formatted)) {
      anchors.push(recurrenceAnchor(formatted, timezone));
    }
  }
  return {
    anchors: anchors.slice(0, limit),
    truncated:
      configuredCount === undefined ||
      countValue > limit ||
      anchors.length > limit,
  };
};

/**
 * Expand only calendar-safe daily/weekly rules. Unsupported RRULE shapes remain
 * source-visible and explicitly truncated instead of inventing DST semantics.
 */
export function summarizeRecurrence(
  properties: readonly IcalPropertyLike[],
  start: string | undefined,
  limit = MAX_RECURRENCE_ANCHORS
): RecurrenceSummary {
  const property = (name: string): string | undefined =>
    properties.find((item) => item.name === name)?.value;
  const values = (name: string): string[] =>
    properties
      .filter((item) => item.name === name)
      .flatMap((item) =>
        item.value
          .split(",")
          .map((value) => recurrenceAnchor(value, item.params?.get("TZID")))
      )
      .map((item) => item.trim())
      .filter(Boolean);

  const recurrenceId = property("RECURRENCE-ID");
  const rrule = property("RRULE");
  const exdates = values("EXDATE").sort();
  const rdates = values("RDATE").sort();
  const explicit = rdates.filter((item) => !exdates.includes(item));
  const startProperty = properties.find((item) => item.name === "DTSTART");
  const startTimezone = startProperty?.params?.get("TZID");
  const rawExdates = new Set(
    properties
      .filter((item) => item.name === "EXDATE")
      .flatMap((item) => item.value.split(","))
  );
  const expanded =
    rrule && start
      ? expandSimpleRule(start, rrule, rawExdates, limit, startTimezone)
      : {
          anchors: start ? [recurrenceAnchor(start, startTimezone)] : [],
          truncated: false,
        };
  const occurrenceAnchors = [...new Set([...expanded.anchors, ...explicit])]
    .sort()
    .slice(0, limit);
  return {
    recurrenceId,
    rrule,
    exdates,
    rdates,
    occurrenceAnchors,
    truncated:
      expanded.truncated || expanded.anchors.length + explicit.length > limit,
  };
}
