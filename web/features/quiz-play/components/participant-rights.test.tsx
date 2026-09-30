// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LiveMotionProvider } from "@/components/quiz-kit/motion";
import { ClaimCard } from "@/features/quiz-play/components/claim-card";
import { MyDataView } from "@/features/quiz-play/components/my-data-panel";
import { ReportDialog } from "@/features/quiz-play/components/report-dialog";
import { ApiError } from "@/lib/api/errors";
import { I18nProvider } from "@/lib/i18n/provider";
import type { LiveMyData } from "@/types/api/live";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

const fetchMocks = vi.hoisted(() => ({
  reportContent: vi.fn(),
  getMyData: vi.fn(),
  eraseMyData: vi.fn(),
  accessWithReturnCode: vi.fn()
}));

vi.mock("@/features/quiz-live/lib/live-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/quiz-live/lib/live-fetch")>();
  return { ...actual, ...fetchMocks };
});

const userState = vi.hoisted(() => ({ data: null as null | { email: string } }));
vi.mock("@/lib/query/hooks", () => ({ useCurrentUser: () => ({ data: userState.data }) }));

const claimMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/live-authoring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/live-authoring")>();
  return { ...actual, claimLiveParticipation: claimMock };
});

function wrap(node: ReactNode) {
  return (
    <I18nProvider locale="en-US" localeFromCookie>
      <LiveMotionProvider>
        <div data-lq-theme="sentinel">{node}</div>
      </LiveMotionProvider>
    </I18nProvider>
  );
}

const myData: LiveMyData = {
  participant: {
    participant_id: "p1",
    display_name: "Ana",
    avatar_seed: "a",
    joined_at: "2026-09-30T10:00:00Z",
    last_seen_at: null,
    consent_version: "2026-09",
    linked_account: false,
    claimed_at: null,
    time_multiplier: 1,
    final_score: 1200,
    final_rank: 2
  },
  session: { session_id: "s1", title: "Redes", status: "finished", started_at: null, ended_at: null },
  answers: [
    { position: 0, prompt: "Porta do HTTPS?", event_type: "answer", response: { text: "443" }, correct: true, points: 900, server_ms: 1200, received_at: null }
  ],
  retention: {},
  claim: { available: true, reason: null, until: "2026-10-07T10:00:00Z" }
};

beforeEach(() => {
  Object.values(fetchMocks).forEach((mock) => mock.mockReset());
  claimMock.mockReset();
  userState.data = null;
});

afterEach(() => cleanup());

describe("ReportDialog (RF-1104)", () => {
  it("requires a reason, then reports the item on screen", async () => {
    fetchMocks.reportContent.mockResolvedValue({ report_id: "r1" });
    const onSent = vi.fn();
    render(wrap(<ReportDialog open onClose={vi.fn()} token="tok" itemQi={2} onSent={onSent} />));
    expect(screen.getByLabelText("This question (item 3)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText("Choose a reason.")).toBeTruthy();
    expect(fetchMocks.reportContent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Offensive content"));
    fireEvent.change(screen.getByLabelText("Details (optional)"), { target: { value: "  bad words  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(fetchMocks.reportContent).toHaveBeenCalledWith("tok", { target: "item", qi: 2, reason: "offensive", note: "bad words" });
  });

  it("reports the whole session when nothing is on screen and shows 429 too_many_reports", async () => {
    fetchMocks.reportContent.mockRejectedValue(new ApiError({ code: "too_many_reports", message: "x", status: 429 }));
    render(wrap(<ReportDialog open onClose={vi.fn()} token="tok" itemQi={null} onSent={vi.fn()} />));
    expect(screen.queryByText(/This question/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Spam or advertising"));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText(/already sent several reports/)).toBeTruthy();
    expect(fetchMocks.reportContent).toHaveBeenCalledWith("tok", { target: "session", reason: "spam" });
  });
});

describe("MyDataView (RF-650)", () => {
  it("shows the data and erases after confirmation", async () => {
    fetchMocks.getMyData.mockResolvedValue(myData);
    fetchMocks.eraseMyData.mockResolvedValue({ erased: true });
    const onErased = vi.fn();
    render(wrap(<MyDataView token="tok" sessionId="s1" onErased={onErased} />));
    expect(await screen.findByText("Porta do HTTPS?")).toBeTruthy();
    expect(screen.getByText("No (guest)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete my data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(onErased).toHaveBeenCalled());
    expect(fetchMocks.eraseMyData).toHaveBeenCalledWith("tok");
  });

  it("asks for the return code when the token is rejected and continues with the new one", async () => {
    fetchMocks.getMyData.mockRejectedValueOnce(new ApiError({ code: "token_expired", message: "x", status: 401 })).mockResolvedValueOnce(myData);
    fetchMocks.accessWithReturnCode.mockResolvedValue({ session_id: "s1", participant_id: "p1", token: "fresh", expires_at: "2099-01-01", display_name: "Ana", avatar_seed: "a" });
    const onTokenRefreshed = vi.fn();
    render(wrap(<MyDataView token="old" sessionId="s1" defaultName="Ana" onTokenRefreshed={onTokenRefreshed} onErased={vi.fn()} />));
    fireEvent.change(await screen.findByLabelText("Return code"), { target: { value: "k7q2mx" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Porta do HTTPS?")).toBeTruthy();
    expect(fetchMocks.accessWithReturnCode).toHaveBeenCalledWith({ session_id: "s1", display_name: "Ana", return_code: "K7Q2MX" });
    expect(onTokenRefreshed).toHaveBeenCalled();
    expect(fetchMocks.getMyData).toHaveBeenLastCalledWith("fresh", expect.anything());
  });

  it("without a token or a known session only explains the rights", () => {
    render(wrap(<MyDataView token={null} sessionId={null} onErased={vi.fn()} />));
    expect(screen.getByText(/You have not joined this room yet/)).toBeTruthy();
  });
});

describe("ClaimCard (RF-633)", () => {
  it("signed out: login and register links come back to the room claim", async () => {
    fetchMocks.getMyData.mockResolvedValue(myData);
    render(wrap(<ClaimCard code="482913" token="tok" sessionId="s1" />));
    const login = await screen.findByRole("link", { name: "Sign in to save" });
    expect(login.getAttribute("href")).toBe(`/login?next=${encodeURIComponent("/j/482913?claim=1")}`);
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe(`/register?next=${encodeURIComponent("/j/482913?claim=1")}`);
  });

  it("signed in: claims and reports how many bank answers entered the progress", async () => {
    userState.data = { email: "ana@example.com" };
    fetchMocks.getMyData.mockResolvedValue(myData);
    claimMock.mockResolvedValue({ claimed: true, bank_answers_recorded: 4 });
    render(wrap(<ClaimCard code="482913" token="tok" sessionId="s1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Save my result to my account" }));
    expect(await screen.findByText("4 Question Bank answers joined your progress.")).toBeTruthy();
    expect(claimMock).toHaveBeenCalledWith("tok");
  });

  it("maps claim errors and stays hidden when the claim is not available", async () => {
    userState.data = { email: "ana@example.com" };
    fetchMocks.getMyData.mockResolvedValue(myData);
    claimMock.mockRejectedValue(new ApiError({ code: "claim_already_in_session", message: "x", status: 409 }));
    const { unmount } = render(wrap(<ClaimCard code="482913" token="tok" sessionId="s1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Save my result to my account" }));
    expect(await screen.findByText("Your account already has a participation in this session.")).toBeTruthy();
    unmount();
    fetchMocks.getMyData.mockResolvedValue({ ...myData, claim: { available: false, reason: "not_available" } });
    render(wrap(<ClaimCard code="482913" token="tok" sessionId="s1" />));
    await waitFor(() => expect(fetchMocks.getMyData).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Save my result to my account")).toBeNull();
  });
});
