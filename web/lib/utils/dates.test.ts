import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime } from "@/lib/utils/format";
import { parseServerDate, parseServerTimestamp } from "@/lib/utils/dates";

const EXPECTED = Date.UTC(2026, 0, 2, 3, 4, 5);

describe("parseServerTimestamp (r4 §3)", () => {
  it.each([
    "2026-01-02T03:04:05Z",
    "2026-01-02T03:04:05z",
    "2026-01-02T03:04:05+00:00",
    "2026-01-02T03:04:05+0000",
    "2026-01-02T03:04:05+00",
    "2026-01-02T00:04:05-03:00",
    "2026-01-02T03:04:05",
    "2026-01-02 03:04:05",
    "  2026-01-02T03:04:05  "
  ])("accepts %s as the same UTC instant", (value) => {
    expect(parseServerTimestamp(value)).toBe(EXPECTED);
  });

  it("keeps sub-second precision from Python microseconds (naive and with offset)", () => {
    expect(parseServerTimestamp("2026-01-02T03:04:05.123456")).toBe(EXPECTED + 123);
    expect(parseServerTimestamp("2026-01-02T03:04:05.123456+00:00")).toBe(EXPECTED + 123);
  });

  it("parses date-only values as the UTC day", () => {
    expect(parseServerTimestamp("2026-01-02")).toBe(Date.UTC(2026, 0, 2));
  });

  it.each([null, undefined, "", "   ", "not a date", "2026-13-45T99:99:99"])("returns null for %s", (value) => {
    expect(parseServerTimestamp(value as string | null | undefined)).toBeNull();
  });

  it("parseServerDate returns a Date for valid input and null otherwise", () => {
    expect(parseServerDate("2026-01-02T03:04:05")?.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(parseServerDate("garbage")).toBeNull();
  });

  it("format helpers use the same parsing (naive == Z)", () => {
    expect(formatDateTime("2026-01-02T03:04:05", "en-US")).toBe(formatDateTime("2026-01-02T03:04:05Z", "en-US"));
    expect(formatDate("2026-01-02T03:04:05+00:00", "pt-BR")).toBe(formatDate("2026-01-02T03:04:05", "pt-BR"));
    expect(formatDateTime("nope", "en-US")).toBe("-");
  });
});
