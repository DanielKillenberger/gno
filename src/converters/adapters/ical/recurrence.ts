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

const parseRule = (value: string): Map<string, string> =>
  new Map(
    value
      .split(";")
      .map((part) => part.split("=", 2))
      .filter((part): part is [string, string] => Boolean(part[0] && part[1]))
      .map(([key, item]) => [key.toUpperCase(), item])
  );

const expandSimpleRule = (
  start: string,
  ruleValue: string,
  exclusions: Set<string>,
  limit: number
): { anchors: string[]; truncated: boolean } => {
  const startParts = parseBasicDate(start);
  if (!startParts) return { anchors: [], truncated: true };
  const rule = parseRule(ruleValue);
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
    if (!exclusions.has(formatted)) anchors.push(formatted);
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
      .flatMap((item) => item.value.split(","))
      .map((item) => item.trim())
      .filter(Boolean);

  const recurrenceId = property("RECURRENCE-ID");
  const rrule = property("RRULE");
  const exdates = values("EXDATE").sort();
  const rdates = values("RDATE").sort();
  const explicit = rdates.filter((item) => !exdates.includes(item));
  const expanded =
    rrule && start
      ? expandSimpleRule(start, rrule, new Set(exdates), limit)
      : { anchors: start ? [start] : [], truncated: false };
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
