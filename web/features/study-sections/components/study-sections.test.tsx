// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { StudySections } from "@/features/study-sections/components/study-sections";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import type { StudySection } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

const { t } = createTranslator(getMessages("pt-BR"));

const SECTIONS: StudySection[] = [
  {
    section_id: "book:c04:head-3-31",
    book_title: "CompTIA Security+ Study Guide",
    chapter_title: "Chapter 4",
    title: "Smishing",
    breadcrumb: ["Chapter 4", "Social Engineering Techniques", "Smishing"],
    page_start: 74,
    page_end: 75,
    excerpt: "Smishing is phishing via SMS.",
    excerpt_truncated: true,
    reason: "your_choice",
    option_key: "C"
  },
  {
    section_id: "book:c04:head-3-30",
    book_title: "CompTIA Security+ Study Guide",
    chapter_title: "Chapter 4",
    title: "Whaling",
    breadcrumb: ["Chapter 4", "Social Engineering Techniques", "Whaling"],
    page_start: 74,
    page_end: 74,
    excerpt: "Whaling targets executives.",
    excerpt_truncated: false,
    reason: "explanation",
    option_key: null
  }
];

function wrap(node: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

afterEach(() => cleanup());

describe("StudySections", () => {
  it("puts the chosen wrong option first, with the key the student saw", () => {
    render(wrap(<StudySections sections={SECTIONS} t={t} />));
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain(t("theory.sections.yourChoice", { key: "C" }));
    expect(items[0].textContent).toContain("Smishing is phishing via SMS.…");
    expect(items[0].textContent).toContain("pp. 74-75");
    expect(items[1].textContent).toContain(t("theory.sections.explanation"));
    expect(items[1].textContent).toContain("p. 74");
  });

  it("opens the full section in a new tab and offers no practice inside a session", () => {
    render(wrap(<StudySections sections={SECTIONS} t={t} />));
    const link = within(screen.getAllByRole("listitem")[1]).getByRole("link");
    expect(link.getAttribute("href")).toBe(`/theory?section=${encodeURIComponent("book:c04:head-3-30")}`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("button", { name: new RegExp(t("theory.sections.practice")) })).toBeNull();
  });

  it("offers practice outside a running session and renders nothing without sections", () => {
    const { unmount } = render(wrap(<StudySections sections={SECTIONS} t={t} allowPractice />));
    expect(screen.getAllByRole("button", { name: new RegExp(t("theory.sections.practice")) })).toHaveLength(2);
    unmount();
    const { container } = render(wrap(<StudySections sections={[]} t={t} />));
    expect(container.textContent).toBe("");
  });
});
