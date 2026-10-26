import { describe, expect, it } from "vitest";
import { formatLocalDate, formatLocalDateTime, formatLocalTime, parseApiTimestamp, systemTimeZone } from "./datetime";

const SYDNEY = "Australia/Sydney";
const BRISBANE = "Australia/Brisbane";

describe("Australian local time", () => {
  it("uses English (Australia), day-month-year, and 24-hour time", () => {
    const value = "2026-07-04T02:05:06.000Z";
    expect(formatLocalDate(value, SYDNEY)).toBe("04/07/2026");
    expect(formatLocalTime(value, SYDNEY)).toBe("12:05:06");
    expect(formatLocalDateTime(value, SYDNEY)).toBe("04/07/2026, 12:05:06 AEST");
    expect(systemTimeZone().length).toBeGreaterThan(0);
  });

  it("converts UTC to AEST in winter and AEDT in summer", () => {
    expect(formatLocalDateTime("2026-07-15T04:35:20.000Z", SYDNEY)).toBe("15/07/2026, 14:35:20 AEST");
    expect(formatLocalDateTime("2026-01-15T04:00:00.000Z", SYDNEY)).toBe("15/01/2026, 15:00:00 AEDT");
    expect(formatLocalDateTime("2026-01-15T04:00:00.000Z", BRISBANE)).toBe("15/01/2026, 14:00:00 AEST");
  });

  it("follows the daylight-saving transitions without a fixed offset", () => {
    expect(formatLocalDateTime("2026-04-04T15:59:00.000Z", SYDNEY)).toBe("05/04/2026, 02:59:00 AEDT");
    expect(formatLocalDateTime("2026-04-04T16:01:00.000Z", SYDNEY)).toBe("05/04/2026, 02:01:00 AEST");
    expect(formatLocalDateTime("2026-10-03T15:59:00.000Z", SYDNEY)).toBe("04/10/2026, 01:59:00 AEST");
    expect(formatLocalDateTime("2026-10-03T16:01:00.000Z", SYDNEY)).toBe("04/10/2026, 03:01:00 AEDT");
  });

  it("moves the calendar date when local midnight is crossed", () => {
    expect(formatLocalDateTime("2026-10-22T14:18:40.200Z", SYDNEY)).toBe("23/10/2026, 01:18:40 AEDT");
    expect(formatLocalDate("2026-10-22T14:18:40.200Z", SYDNEY)).toBe("23/10/2026");
    expect(formatLocalDateTime("2026-07-15T14:30:00.000Z", SYDNEY)).toBe("16/07/2026, 00:30:00 AEST");
    expect(formatLocalTime("2026-10-22T13:00:00.000Z", SYDNEY)).toBe("00:00:00");
  });

  it("shows a missing or unreadable timestamp without inventing one", () => {
    expect(formatLocalDateTime(null)).toBe("Not yet recorded");
    expect(formatLocalDateTime(undefined)).toBe("Not yet recorded");
    expect(formatLocalDateTime("")).toBe("Not yet recorded");
    expect(formatLocalDateTime("Not Verified")).toBe("Not yet recorded");
    expect(formatLocalDate("not a date", SYDNEY)).toBe("Not yet recorded");
  });

  it("accepts the UTC timestamps the API already returns", () => {
    const zoned = "2026-10-22T14:18:40.200Z";
    const plain = "2026-10-22T14:18:40Z";
    const offset = "2026-10-22T14:18:40.200+00:00";
    expect(parseApiTimestamp(zoned)?.toISOString()).toBe("2026-10-22T14:18:40.200Z");
    expect(formatLocalDateTime(zoned, SYDNEY)).toBe(formatLocalDateTime(plain, SYDNEY));
    expect(formatLocalDateTime(offset, SYDNEY)).toBe("23/10/2026, 01:18:40 AEDT");
    expect(parseApiTimestamp(zoned)?.toISOString()).toBe(zoned);
  });
});
