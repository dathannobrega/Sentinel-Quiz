import type { CitationItem } from "@/types/api";

function buildCitationParams(citation: CitationItem): URLSearchParams | null {
  const materialPath = String(citation.material_path || "").trim();
  if (!materialPath) {
    return null;
  }

  const params = new URLSearchParams();
  params.set("material_path", materialPath);

  const locator = String(citation.locator || "").trim();
  if (locator) {
    params.set("locator", locator);
  }

  const pageStart = citation.page_start;
  if (pageStart !== null && pageStart !== undefined && String(pageStart).trim()) {
    params.set("page_start", String(pageStart).trim());
  }

  const pageEnd = citation.page_end;
  if (pageEnd !== null && pageEnd !== undefined && String(pageEnd).trim()) {
    params.set("page_end", String(pageEnd).trim());
  }
  return params;
}

/**
 * API path (for apiClient) of the authenticated material preview (contract §4).
 * There is intentionally no link to the original file: /materials is not served anymore.
 */
export function buildMaterialPreviewPath(citation: CitationItem): string | null {
  const params = buildCitationParams(citation);
  return params ? `/materials/preview?${params.toString()}` : null;
}

export function buildTheoryReaderHref(citation: CitationItem): string | null {
  const params = buildCitationParams(citation);
  if (!params) {
    return null;
  }

  const label = String(citation.reference || citation.source || "").trim();
  if (label) {
    params.set("label", label);
  }

  return `/theory?${params.toString()}`;
}

/**
 * Removes anything in the preview HTML that points at the original file download
 * (legacy "/materials/..." links) and all scripts before rendering it in a sandboxed iframe.
 */
export function sanitizeMaterialPreviewHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, object, embed").forEach((node) => node.remove());
  doc.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    if (/(^|\/)materials\//.test(href) && !/materials\/preview/.test(href)) {
      anchor.remove();
    }
  });
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
