// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import {
  normalizeModuleStatus,
  pendingPrerequisiteTitles,
  StudyTrackCard
} from "@/features/dashboard/components/study-track-card";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import { I18nProvider } from "@/lib/i18n/provider";
import type { StudyModule } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

const { t } = createTranslator(getMessages("en-US"));

function module(overrides: Partial<StudyModule> & Pick<StudyModule, "id" | "code" | "position" | "title">): StudyModule {
  return {
    certification: "Security+",
    description: null,
    domain: null,
    ...overrides
  };
}

const MODULES: StudyModule[] = [
  module({
    id: 1,
    code: "SP-01",
    position: 1,
    title: "Security concepts",
    domain: "General Security Concepts",
    prerequisite_codes: [],
    status: "completed",
    mastery_percent: 86.4,
    attempted: 14
  }),
  module({
    id: 2,
    code: "SP-02",
    position: 2,
    title: "Threat actors",
    domain: "Threats, Vulnerabilities, and Mitigations",
    prerequisite_codes: ["SP-01"],
    status: "in_progress",
    mastery_percent: 55,
    attempted: 4
  }),
  module({
    id: 3,
    code: "SP-03",
    position: 3,
    title: "Architecture",
    domain: "Security Architecture",
    prerequisite_codes: ["SP-01", "SP-02"],
    status: "locked",
    mastery_percent: null,
    attempted: 0
  }),
  module({
    id: 4,
    code: "SP-04",
    position: 4,
    title: "Operations",
    prerequisite_codes: [],
    status: "available",
    mastery_percent: null,
    attempted: 0
  })
];

afterEach(() => cleanup());

function renderCard(modules: StudyModule[], recommended: Pick<StudyModule, "id" | "code"> | null = null) {
  return render(
    <I18nProvider locale="en-US" localeFromCookie>
      <StudyTrackCard certification="Security+" modules={modules} recommendedModule={recommended} />
    </I18nProvider>
  );
}

describe("StudyTrackCard (contract r4 §2)", () => {
  it("renders every status as text (icon is decorative), plus mastery and summary", () => {
    renderCard(MODULES, { id: 2, code: "SP-02" });

    const expectations: Array<[string, string]> = [
      ["SP-01", "completed"],
      ["SP-02", "in_progress"],
      ["SP-03", "locked"],
      ["SP-04", "available"]
    ];
    for (const [code, status] of expectations) {
      const item = screen.getByTestId(`track-module-${code}`);
      expect(item.getAttribute("data-status")).toBe(status);
      expect(within(item).getByText(t(`dashboard.trackCard.status.${status}`))).toBeTruthy();
      item.querySelectorAll("svg").forEach((svg) => expect(svg.getAttribute("aria-hidden")).toBe("true"));
    }

    expect(within(screen.getByTestId("track-module-SP-01")).getByText(t("dashboard.trackCard.mastery", { value: "86.4%" }))).toBeTruthy();
    expect(within(screen.getByTestId("track-module-SP-03")).getByText(t("dashboard.trackCard.masteryUnknown"))).toBeTruthy();
    expect(screen.getByText(t("dashboard.trackCard.summary", { completed: 1, total: 4 }))).toBeTruthy();
    expect(screen.getByRole("list", { name: t("dashboard.trackCard.listLabel", { certification: "Security+" }) })).toBeTruthy();
  });

  it("lists pending prerequisites by module title, skipping completed ones", () => {
    renderCard(MODULES);
    const locked = screen.getByTestId("track-module-SP-03");
    expect(locked.textContent).toContain(t("dashboard.trackCard.pendingPrerequisites", { items: "Threat actors" }));
    expect(locked.textContent).not.toContain("Security concepts,");
    // SP-02 depends only on the completed SP-01: nothing pending.
    expect(screen.getByTestId("track-module-SP-02").textContent).not.toContain(
      t("dashboard.trackCard.pendingPrerequisites", { items: "" }).trim()
    );
  });

  it("highlights the recommended module with aria-current and a text badge", () => {
    renderCard(MODULES, { id: 2, code: "SP-02" });
    const recommended = screen.getByTestId("track-module-SP-02");
    expect(recommended.getAttribute("aria-current")).toBe("step");
    expect(within(recommended).getByText(t("dashboard.trackCard.recommended"))).toBeTruthy();
    expect(screen.getAllByText(t("dashboard.trackCard.recommended"))).toHaveLength(1);
    expect(screen.getByTestId("track-module-SP-01").getAttribute("aria-current")).toBeNull();
  });

  it("degrades gracefully for older backends without status fields", () => {
    const legacy = MODULES.map(({ id, code, position, title, certification, description, domain }) => ({
      id,
      code,
      position,
      title,
      certification,
      description,
      domain
    }));
    renderCard(legacy, { id: 1, code: "SP-01" });
    expect(screen.getByText("1. Security concepts")).toBeTruthy();
    expect(screen.queryByText(t("dashboard.trackCard.status.locked"))).toBeNull();
    expect(screen.queryByText(t("dashboard.trackCard.summary", { completed: 0, total: 4 }))).toBeNull();
    expect(screen.getByTestId("track-module-SP-01").getAttribute("aria-current")).toBe("step");
  });
});

describe("track helpers", () => {
  it("normalizes unknown statuses to null", () => {
    expect(normalizeModuleStatus("completed")).toBe("completed");
    expect(normalizeModuleStatus("weird")).toBeNull();
    expect(normalizeModuleStatus(undefined)).toBeNull();
  });

  it("falls back to the code for prerequisites outside the list", () => {
    const orphan = module({ id: 9, code: "X", position: 9, title: "X", prerequisite_codes: ["SP-99", "SP-01"] });
    expect(pendingPrerequisiteTitles(orphan, MODULES)).toEqual(["SP-99"]);
  });
});
