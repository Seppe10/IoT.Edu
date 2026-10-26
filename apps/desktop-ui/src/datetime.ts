export const APP_LOCALE = "en-AU";
export const MISSING_TIMESTAMP = "Not yet recorded";

const EASTERN_DAYLIGHT = new Set([
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Hobart",
  "Australia/Currie",
  "Australia/Canberra",
  "Australia/ACT",
  "Australia/NSW",
  "Australia/Victoria",
  "Australia/Tasmania",
]);

const EASTERN_STANDARD = new Set([
  "Australia/Brisbane",
  "Australia/Lindeman",
  "Australia/Queensland",
]);

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function parseApiTimestamp(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value.trim())) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalDate(value: unknown, timeZone = systemTimeZone()): string {
  const parts = localParts(value, timeZone);
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : MISSING_TIMESTAMP;
}

export function formatLocalTime(value: unknown, timeZone = systemTimeZone()): string {
  const parts = localParts(value, timeZone);
  return parts ? `${parts.hour}:${parts.minute}:${parts.second}` : MISSING_TIMESTAMP;
}

export function formatLocalDateTime(value: unknown, timeZone = systemTimeZone()): string {
  const parts = localParts(value, timeZone);
  if (!parts) return MISSING_TIMESTAMP;
  const zone = easternAbbreviation(parts.date, timeZone);
  return `${parts.day}/${parts.month}/${parts.year}, ${parts.hour}:${parts.minute}:${parts.second}${zone ? ` ${zone}` : ""}`;
}

function localParts(value: unknown, timeZone: string): {
  date: Date;
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} | null {
  const date = parseApiTimestamp(value);
  if (!date) return null;
  try {
    const formatted = new Intl.DateTimeFormat(APP_LOCALE, {
      timeZone,
      calendar: "gregory",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date);
    const bag: Record<string, string> = {};
    for (const part of formatted) {
      if (part.type !== "literal") bag[part.type] = part.value;
    }
    let hour = bag.hour ?? "";
    if (hour === "24") hour = "00";
    if (!bag.year || !bag.month || !bag.day || !hour || !bag.minute || !bag.second) return null;
    return { date, year: bag.year, month: bag.month, day: bag.day, hour, minute: bag.minute, second: bag.second };
  } catch {
    return null;
  }
}

function easternAbbreviation(date: Date, timeZone: string): "AEST" | "AEDT" | null {
  if (EASTERN_STANDARD.has(timeZone)) return "AEST";
  if (!EASTERN_DAYLIGHT.has(timeZone)) return null;
  const year = Number(new Intl.DateTimeFormat(APP_LOCALE, { timeZone, year: "numeric" }).format(date));
  const winter = new Date(Date.UTC(year, 6, 15, 2, 0, 0));
  return offsetMinutes(date, timeZone) > offsetMinutes(winter, timeZone) ? "AEDT" : "AEST";
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const bag: Record<string, string> = {};
  for (const part of formatted) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const wallClock = Date.UTC(Number(bag.year), Number(bag.month) - 1, Number(bag.day), hour, Number(bag.minute), Number(bag.second));
  return Math.round((wallClock - instant.getTime()) / 60000);
}
