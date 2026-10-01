// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { GaReportDetail } from "@/features/quiz-reports/components/ga-report";
import { I18nProvider } from "@/lib/i18n/provider";
import type { LiveReportItem } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

afterEach(() => cleanup());

const base: LiveReportItem = {
  position: 0,
  item_type: "ordering",
  prompt: "Ordene",
  scored: true,
  answered: 3,
  n_correct: 1,
  p: 0.333,
  discrimination: null,
  avg_ms: null,
  median_ms: null,
  flags: [],
  options: [],
  domain: null
};

function show(item: LiveReportItem) {
  return render(
    <I18nProvider locale="pt-BR" localeFromCookie>
      <GaReportDetail item={item} />
    </I18nProvider>
  );
}

describe("GaReportDetail", () => {
  it("ordering: correct order with per-slot accuracy, exact count and average credit", () => {
    show({
      ...base,
      ordering: { correct_order: ["Preparação", "Detecção", "Contenção"], slot_pct_correct: [33.3, null, 66.7], exact: 1, avg_fraction: 0.52, method: "kendall" }
    });
    expect(screen.getByText("Posição 1, Preparação: 33% acertaram")).toBeTruthy();
    expect(screen.getByText("Posição 2, Detecção: – acertaram")).toBeTruthy();
    expect(screen.getByText("Ordem exata: 1 · Crédito médio: 52%")).toBeTruthy();
    expect(screen.getByText("Pontuação parcial (Kendall)")).toBeTruthy();
  });

  it("numeric: answer ± tolerance and the stats in the UI locale", () => {
    show({
      ...base,
      item_type: "numeric",
      numeric: { min: 0, max: 1000, bins: Array.from({ length: 20 }, (_, index) => (index === 5 ? 2 : index === 18 ? 1 : 0)), n: 3, mean: 477, median: 275, value: 256, tolerance: 10, unit: "bits" }
    });
    expect(screen.getByText("Resposta: 256 bits (± 10 bits)")).toBeTruthy();
    expect(screen.getByText("3 respostas · Média: 477 bits · Mediana: 275 bits")).toBeTruthy();
    expect(screen.getByText(/de 250 bits a 300 bits: 2/)).toBeTruthy();
  });

  it("word cloud: every word with its count; hidden ones stay listed and marked", () => {
    show({
      ...base,
      item_type: "word_cloud",
      p: null,
      word_cloud: {
        words: [
          { text: "Senha", key: "senha", n: 2, hidden: false },
          { text: "Backup", key: "backup", n: 1, hidden: true }
        ],
        distinct: 2
      }
    });
    expect(screen.getByText("Senha")).toBeTruthy();
    expect(screen.getByText("Backup").className).toContain("line-through");
    expect(screen.getByText("(ocultada pelo apresentador)")).toBeTruthy();
  });
});
