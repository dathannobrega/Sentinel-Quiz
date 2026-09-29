import { afterEach, describe, expect, it } from "vitest";

import { readCountHeader } from "@/lib/api/client";
import { DEFAULT_TUTOR_TIMEOUT_MS, parseTutorTimeoutMs } from "@/lib/config/runtime";
import { getServerRuntimeConfig, serializeRuntimeConfig } from "@/lib/config/server-runtime";

const ORIGINAL = process.env["TUTOR_CLIENT_TIMEOUT_MS"];

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env["TUTOR_CLIENT_TIMEOUT_MS"];
  } else {
    process.env["TUTOR_CLIENT_TIMEOUT_MS"] = ORIGINAL;
  }
});

describe("tutor client timeout", () => {
  it("defaults to 45s", () => {
    expect(DEFAULT_TUTOR_TIMEOUT_MS).toBe(45_000);
  });

  it("accepts values within 5s..300s and rejects the rest", () => {
    expect(parseTutorTimeoutMs("60000")).toBe(60_000);
    expect(parseTutorTimeoutMs(" 90000 ")).toBe(90_000);
    expect(parseTutorTimeoutMs(5_000)).toBe(5_000);
    expect(parseTutorTimeoutMs("")).toBeNull();
    expect(parseTutorTimeoutMs(undefined)).toBeNull();
    expect(parseTutorTimeoutMs("abc")).toBeNull();
    expect(parseTutorTimeoutMs("1000")).toBeNull();
    expect(parseTutorTimeoutMs("900000")).toBeNull();
  });

  it("is read from TUTOR_CLIENT_TIMEOUT_MS at request time and serialized for the page", () => {
    process.env["TUTOR_CLIENT_TIMEOUT_MS"] = "70000";
    const config = getServerRuntimeConfig();
    expect(config.tutorTimeoutMs).toBe(70_000);
    expect(serializeRuntimeConfig(config)).toContain('"tutorTimeoutMs":70000');

    process.env["TUTOR_CLIENT_TIMEOUT_MS"] = "not-a-number";
    expect(getServerRuntimeConfig().tutorTimeoutMs).toBeNull();
  });
});

describe("readCountHeader", () => {
  it("parses X-Total-Count and ignores missing/malformed values", () => {
    expect(readCountHeader(new Headers({ "X-Total-Count": "123" }))).toBe(123);
    expect(readCountHeader(new Headers({ "x-total-count": "0" }))).toBe(0);
    expect(readCountHeader(new Headers())).toBeNull();
    expect(readCountHeader(new Headers({ "X-Total-Count": "-1" }))).toBeNull();
    expect(readCountHeader(new Headers({ "X-Total-Count": "12.5" }))).toBeNull();
  });
});
