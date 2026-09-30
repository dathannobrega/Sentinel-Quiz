// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DraftCard } from "@/features/quiz-builder/components/ai/ai-draft-card";
import { AiGenerateDialog } from "@/features/quiz-builder/components/ai/ai-generate-dialog";
import { ItemProperties } from "@/features/quiz-builder/components/editor/item-properties";
import { apiClient } from "@/lib/api/client";
import { I18nProvider } from "@/lib/i18n/provider";
import type { AiCapabilities, AiDraftItem, LiveItem, LiveLimits } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/quizzes/q1/edit"
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="en-US" localeFromCookie>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  );
}

const CAPS: AiCapabilities = {
  enabled: true,
  reason: null,
  provider: "fake",
  model: "fake-1",
  critic_enabled: true,
  credits: { daily_limit: 300, used_today: 10, remaining: 290 },
  limits: { max_items: 20, source_max_chars: 20000, topic_max_chars: 500 },
  item_types: ["single_choice", "multi_choice", "true_false", "type_answer"],
  certifications: [{ id: "securityplus", label: "Security+ SY0-701", domains: ["General Security Concepts", "Security Operations"] }]
};

beforeEach(() => {
  vi.spyOn(apiClient, "get").mockImplementation(async (path: string) => {
    if (path.startsWith("/ai/jobs?")) return { items: [] };
    if (path === "/live/bank/facets") return { certifications: [{ id: "securityplus", label: "Security+", count: 900 }], domains: [] };
    throw new Error(`unexpected GET ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(overrides: Partial<Parameters<typeof AiGenerateDialog>[0]> = {}) {
  const props: Parameters<typeof AiGenerateDialog>[0] = {
    open: true,
    onClose: vi.fn(),
    quizId: "q1",
    quizLanguage: "en",
    capacity: 20,
    itemTypes: CAPS.item_types,
    capabilities: CAPS,
    unavailable: null,
    initialTab: "topic",
    jobId: null,
    onJobChange: vi.fn(),
    applyDrafts: vi.fn(async () => []),
    addFromBank: vi.fn(),
    onOpenItem: vi.fn(),
    ...overrides
  };
  render(<AiGenerateDialog {...props} />, { wrapper });
  return props;
}

describe("AI dialog", () => {
  it("shows the three tabs, the topic form, credits and the cost preview", () => {
    renderDialog();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["From a topic", "From a text", "Draw from the bankno AI"]);
    expect(screen.getByRole("tab", { name: /From a topic/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Topic or objective")).toBeTruthy();
    expect(screen.getByLabelText("Certification")).toBeTruthy();
    expect(screen.getByText("290 of 300 credits today")).toBeTruthy();
    expect(screen.getByText(/Cost: 10 credits/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate 10 questions/ })).toBeTruthy();
  });

  it("filters domains by certification and validates before creating a job", async () => {
    const post = vi.spyOn(apiClient, "post");
    const props = renderDialog();
    expect(screen.getByText("Choose a certification to see its domains.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Generate 10 questions/ }));
    expect(await screen.findByText("Enter a topic or choose a certification.")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Certification"), { target: { value: "securityplus" } });
    fireEvent.click(screen.getByLabelText("Security Operations"));
    post.mockResolvedValueOnce({ id: "job-1", quiz_id: "q1", status: "queued" });
    fireEvent.click(screen.getByRole("button", { name: /Generate 10 questions/ }));
    await waitFor(() => expect(props.onJobChange).toHaveBeenCalledWith("job-1"));
    expect(post).toHaveBeenCalledWith("/ai/quiz-drafts/generate", {
      quiz_id: "q1",
      certification: "securityplus",
      domains: ["Security Operations"],
      level: "mixed",
      n: 10,
      types: ["single_choice", "multi_choice"],
      language: "en"
    });
  });

  it("counts pasted text against the 200-character minimum (keyboard tab navigation)", () => {
    renderDialog();
    fireEvent.keyDown(screen.getByRole("tab", { name: /From a topic/ }), { key: "ArrowRight" });
    const textarea = screen.getByLabelText("Source text");
    fireEvent.change(textarea, { target: { value: "a".repeat(50) } });
    expect(screen.getByText("150 more characters to reach the minimum of 200.")).toBeTruthy();
    expect(screen.getByText("50 / 20,000")).toBeTruthy();
  });

  it("opens on the bank draw with guest-only on when AI is unavailable, and explains why", async () => {
    renderDialog({ unavailable: "ai_disabled", initialTab: "topic" });
    expect(screen.getByText("AI authoring is turned off")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Draw from the bank/ }).getAttribute("aria-selected")).toBe("true");
    const guest = screen.getByLabelText(/Only questions cleared for guests/) as HTMLInputElement;
    expect(guest.checked).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: /From a topic/ }));
    const submit = screen.getByRole("button", { name: /Generate 10 questions/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});

function draft(overrides: Partial<AiDraftItem> = {}): AiDraftItem {
  return {
    index: 0,
    item_type: "single_choice",
    prompt: "Which port does HTTPS use by default?",
    options: [
      { key: "A", text: "443", correct: true, why_wrong: null },
      { key: "B", text: "80", correct: false, why_wrong: "80 is plain HTTP." }
    ],
    accepted_answers: [],
    explanation: "TLS on 443.",
    time_limit_s: 20,
    difficulty: "Easy",
    domain: "Security Operations",
    certification: "securityplus",
    issues: [{ code: "length_bias", severity: "warning", message: "Correct option is longer.", field: "options" }],
    critic: { solved_keys: ["B"], confidence: 0.42, flags: ["key_mismatch", "ambiguous"], notes: ["Port 80 redirects."] },
    applied: false,
    blocked: false,
    ...overrides
  };
}

describe("DraftCard", () => {
  it("explains the critic flags in plain language and marks the correct option with text", () => {
    render(
      <DraftCard draft={draft()} number={1} selected forced={false} selectionDisabled={false} criticEnabled onToggle={vi.fn()} onForce={vi.fn()} />,
      { wrapper }
    );
    expect(screen.getByText(/The automatic reviewer, without seeing the key, chose B \(the key says A\)\./)).toBeTruthy();
    expect(screen.getByText(/More than one answer can be defended/)).toBeTruthy();
    expect(screen.getByText("Confidence 42%")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Automatic reviewer confidence" }).getAttribute("aria-valuenow")).toBe("42");
    const options = within(screen.getByRole("list", { name: "Options" })).getAllByRole("listitem");
    expect(options[0]?.textContent).toContain("Correct");
    expect(options[1]?.textContent).not.toContain("Correct");
    expect(screen.getByText("Warning")).toBeTruthy();
    expect(screen.getByText("Why B is wrong")).toBeTruthy();
    expect(screen.getByText(/you will confirm this question's answer key/)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("keeps a blocked draft unselectable until 'Add anyway'", () => {
    const onToggle = vi.fn();
    const onForce = vi.fn();
    render(
      <DraftCard
        draft={draft({ issues: [{ code: "duplicate_option", severity: "error", message: "Options B and C are equal.", field: "options" }], critic: null })}
        number={2}
        selected={false}
        forced={false}
        selectionDisabled={false}
        criticEnabled
        onToggle={onToggle}
        onForce={onForce}
      />,
      { wrapper }
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Blocked by an error")).toBeTruthy();
    const force = screen.getByRole("button", { name: "Add anyway" });
    expect(force.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(force);
    expect(onForce).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

const LIMITS: LiveLimits = {
  max_participants: 200,
  max_items: 50,
  prompt_max: 400,
  option_max: 120,
  options_min: 2,
  options_max: 6,
  time_limit_min: 5,
  time_limit_max: 240
};

function aiItem(requiresConfirmation: boolean): LiveItem {
  return {
    id: "i1",
    position: 0,
    item_type: "single_choice",
    prompt: "Which port does HTTPS use?",
    options: [
      { key: "A", text: "443", correct: true },
      { key: "B", text: "80", correct: false }
    ],
    accepted_answers: [],
    allow_multiple: false,
    all_or_nothing: false,
    body: null,
    time_limit_s: 20,
    points_multiplier: 1,
    explanation: null,
    presenter_notes: null,
    source_kind: "ai",
    source_question_id: null,
    source_version_id: null,
    license_scope: "own",
    review_state: "needs_review",
    domain: null,
    certification: null,
    difficulty: null,
    updated_at: "2026-09-30T10:00:00Z",
    ai: {
      job_id: "j1",
      model: "fake-1",
      issues: [],
      critic: requiresConfirmation ? { solved_keys: ["B"], confidence: 0.4, flags: ["key_mismatch"], notes: [] } : null,
      requires_key_confirmation: requiresConfirmation
    }
  };
}

describe("answer-key confirmation gate", () => {
  it("requires 'I checked this question's answer key' before approving, then sends confirm_key", () => {
    const onReview = vi.fn();
    render(
      <ItemProperties item={aiItem(true)} issues={[]} themeKey="sentinel" limits={LIMITS} readOnly={false} reviewing={false} onPatch={vi.fn()} onReview={onReview} />,
      { wrapper }
    );
    expect(screen.getAllByText("AI-generated").length).toBeGreaterThan(0);
    expect(screen.getByText(/without seeing the key, chose B; the current key is A/)).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Mark as reviewed" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(onReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("I checked this question's answer key"));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    expect(onReview).toHaveBeenCalledWith(true);
  });

  it("approves directly (without confirm_key) when the critic raised nothing", () => {
    const onReview = vi.fn();
    render(
      <ItemProperties item={aiItem(false)} issues={[]} themeKey="sentinel" limits={LIMITS} readOnly={false} reviewing={false} onPatch={vi.fn()} onReview={onReview} />,
      { wrapper }
    );
    expect(screen.queryByLabelText("I checked this question's answer key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark as reviewed" }));
    expect(onReview).toHaveBeenCalledWith(false);
  });
});
