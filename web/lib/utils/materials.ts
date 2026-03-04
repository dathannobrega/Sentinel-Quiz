import type { CitationItem } from "@/types/api";
import { getRuntimeConfig } from "@/lib/config/runtime";

export function buildMaterialPreviewHref(citation: CitationItem): string | null {
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

  return `${getRuntimeConfig().apiOrigin}/api/materials/preview?${params.toString()}`;
}

export function buildTheoryReaderHref(citation: CitationItem): string | null {
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

  const label = String(citation.reference || citation.source || "").trim();
  if (label) {
    params.set("label", label);
  }

  return `/theory?${params.toString()}`;
}
