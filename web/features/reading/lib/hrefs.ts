/** Route helpers for the reader (section ids contain ":" and are URL-encoded). */

export function buildReaderHref(sectionId: string): string {
  return `/read/s/${encodeURIComponent(sectionId)}`;
}

export function buildBookHref(slug: string): string {
  return `/read/${encodeURIComponent(slug)}`;
}
