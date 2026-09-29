/**
 * Single place where API timestamps are parsed (contract r4 §3).
 *
 * The backend serializes ISO 8601 with an explicit offset (`+00:00` or `Z`). Older payloads
 * (and some legacy rows) are naive `datetime.isoformat()` strings: those are UTC and must NOT
 * be interpreted in the browser's local timezone. Accepted inputs:
 *   2026-01-02T03:04:05Z · 2026-01-02T03:04:05.123456+00:00 · 2026-01-02T03:04:05-0300
 *   2026-01-02T03:04:05 (naive → UTC) · 2026-01-02 03:04:05 (naive → UTC) · 2026-01-02 (UTC day)
 */

const ZONE_SUFFIX = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const FRACTION = /(\.\d{3})\d+/;

function normalizeIsoString(raw: string): string {
  let value = raw.trim();
  if (DATE_ONLY.test(value)) {
    // ECMAScript already parses date-only ISO strings as UTC.
    return value;
  }
  // "YYYY-MM-DD HH:MM:SS" (SQL style) → ISO "T" separator.
  value = value.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2");
  // Python emits microseconds; some engines only accept milliseconds.
  value = value.replace(FRACTION, "$1");
  // "+0000" / "+00" → "+00:00" (strict ISO accepted by every engine).
  value = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2").replace(/([+-]\d{2})$/, "$1:00");
  if (!ZONE_SUFFIX.test(value)) {
    return `${value}Z`;
  }
  return value;
}

/** Epoch milliseconds for an API timestamp, or null when missing/invalid. Naive values are UTC. */
export function parseServerTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(normalizeIsoString(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/** Date for an API timestamp, or null when missing/invalid. Naive values are UTC. */
export function parseServerDate(value: string | null | undefined): Date | null {
  const timestamp = parseServerTimestamp(value);
  return timestamp === null ? null : new Date(timestamp);
}
