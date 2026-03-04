import Link from "next/link";

import { Card } from "@/components/ui/card";
import { buildMaterialPreviewHref } from "@/lib/utils/materials";
import type { CitationItem } from "@/types/api";

function takeFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function buildPageLabel(pageStart?: string, pageEnd?: string): string | null {
  const start = String(pageStart || "").trim();
  const end = String(pageEnd || "").trim();
  if (start && end && start !== end) {
    return `pp. ${start}-${end}`;
  }
  if (start) {
    return `p. ${start}`;
  }
  return null;
}

export default async function TheoryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const materialPath = takeFirst(params.material_path) || "";
  const locator = takeFirst(params.locator);
  const pageStart = takeFirst(params.page_start);
  const pageEnd = takeFirst(params.page_end);
  const label = takeFirst(params.label);

  const citation: CitationItem = {
    material_path: materialPath,
    locator: locator || undefined,
    page_start: pageStart || undefined,
    page_end: pageEnd || undefined,
    reference: label || undefined,
  };
  const previewHref = materialPath ? buildMaterialPreviewHref(citation) : null;
  const pageLabel = buildPageLabel(pageStart, pageEnd);
  const title = label || "Revisão teórica";

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <header className="sq-topbar">
          <div className="sq-brand">
            <div className="sq-logo" aria-hidden="true">
              SQ
            </div>
            <div className="sq-brand-copy">
              <div className="sq-page-title">Revisão teórica</div>
              <p className="sq-page-subtitle">Abra o trecho citado e releia a base conceitual da questão.</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/review">Fila de revisão</Link>
            <Link href="/dashboard">Dashboard</Link>
          </div>
        </header>

        <Card
          title={title}
          subtitle="Leitura rápida do trecho referenciado no material de estudo."
          actions={
            previewHref ? (
              <a href={previewHref} target="_blank" rel="noreferrer noopener">
                Abrir em nova aba
              </a>
            ) : undefined
          }
        >
          <div className="sq-surface-block">
            <div className="sq-chip-row">
              {materialPath ? <span className="sq-chip">{materialPath.split("/").pop()}</span> : null}
              {pageLabel ? <span className="sq-chip">{pageLabel}</span> : null}
              {locator ? <span className="sq-chip">{locator}</span> : null}
            </div>
          </div>

          <div
            className="sq-surface-block"
            style={{
              marginTop: "var(--sq-space-4)",
              padding: 0,
              overflow: "hidden",
              minHeight: "72vh",
            }}
          >
            {previewHref ? (
              <iframe
                src={previewHref}
                title={title}
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: "72vh",
                  border: 0,
                  background: "rgba(255,255,255,0.92)",
                }}
              />
            ) : (
              <div className="sq-empty" style={{ padding: "var(--sq-space-6)" }}>
                O trecho não possui um material válido para abrir.
              </div>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
