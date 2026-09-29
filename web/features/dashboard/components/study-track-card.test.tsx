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

// CEH v13 track (contract r5 §C): 20 modules with a prerequisite graph, shape as served by /study/modules.
const CEH_TRACK: Array<[string, string, string, string[]]> = [
  ["M01", "Introduction to Ethical Hacking", "Information Security and Ethical Hacking Overview", []],
  ["M02", "Footprinting and Reconnaissance", "Reconnaissance Techniques", ["M01"]],
  ["M03", "Scanning Networks", "Reconnaissance Techniques", ["M02"]],
  ["M04", "Enumeration", "Reconnaissance Techniques", ["M03"]],
  ["M05", "Vulnerability Analysis", "System Hacking Phases and Attack Techniques", ["M04"]],
  ["M06", "System Hacking", "System Hacking Phases and Attack Techniques", ["M05"]],
  ["M07", "Malware Threats", "System Hacking Phases and Attack Techniques", ["M06"]],
  ["M08", "Sniffing", "Network and Perimeter Hacking", ["M03"]],
  ["M09", "Social Engineering", "Network and Perimeter Hacking", ["M02"]],
  ["M10", "Denial-of-Service", "Network and Perimeter Hacking", ["M03"]],
  ["M11", "Session Hijacking", "Network and Perimeter Hacking", ["M08"]],
  ["M12", "Evading IDS, Firewalls, and Honeypots", "Network and Perimeter Hacking", ["M03", "M08"]],
  ["M13", "Hacking Web Servers", "Web Application Hacking", ["M03", "M05"]],
  ["M14", "Hacking Web Applications", "Web Application Hacking", ["M13"]],
  ["M15", "SQL Injection", "Web Application Hacking", ["M14"]],
  ["M16", "Hacking Wireless Networks", "Wireless Network Hacking", ["M08"]],
  ["M17", "Hacking Mobile Platforms", "Mobile Platform, IoT, and OT Hacking", ["M07", "M14"]],
  ["M18", "IoT and OT Hacking", "Mobile Platform, IoT, and OT Hacking", ["M03", "M04"]],
  ["M19", "Cloud Computing", "Cloud Computing", ["M14"]],
  ["M20", "Cryptography", "Cryptography", ["M01"]]
];

describe("StudyTrackCard with the CEH track", () => {
  it("renders all 20 CEH modules in order with statuses and prerequisites", () => {
    const modules: StudyModule[] = CEH_TRACK.map(([code, title, domain, prerequisites], index) =>
      module({
        id: 100 + index,
        code,
        // Served out of order on purpose: the card sorts by position.
        position: index + 1,
        title,
        domain,
        certification: "CEH",
        prerequisite_codes: prerequisites,
        status: index < 2 ? "completed" : index === 2 ? "in_progress" : prerequisites.every((p) => p === "M01" || p === "M02") ? "available" : "locked",
        mastery_percent: index < 3 ? 70 + index : null,
        attempted: index < 3 ? 5 : 0
      })
    ).reverse();
    render(
      <I18nProvider locale="en-US" localeFromCookie>
        <StudyTrackCard certification="CEH" modules={modules} recommendedModule={{ id: 102, code: "M03" }} />
      </I18nProvider>
    );

    const list = screen.getByRole("list", { name: t("dashboard.trackCard.listLabel", { certification: "CEH" }) });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(20);
    expect(items.map((item) => item.getAttribute("data-testid"))).toEqual(CEH_TRACK.map(([code]) => `track-module-${code}`));
    expect(screen.getByText(t("dashboard.trackCard.title", { certification: "CEH" }))).toBeTruthy();
    expect(screen.getByText(t("dashboard.trackCard.summary", { completed: 2, total: 20 }))).toBeTruthy();
    expect(screen.getByTestId("track-module-M03").getAttribute("aria-current")).toBe("step");
    // Multi-prerequisite module lists every pending prerequisite by title.
    expect(screen.getByTestId("track-module-M12").textContent).toContain(
      t("dashboard.trackCard.pendingPrerequisites", { items: "Scanning Networks, Sniffing" })
    );
    expect(within(screen.getByTestId("track-module-M20")).getByText(t("dashboard.trackCard.status.available"))).toBeTruthy();
    expect(within(screen.getByTestId("track-module-M17")).getByText("Mobile Platform, IoT, and OT Hacking")).toBeTruthy();
  });
});
