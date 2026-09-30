// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LiveMotionProvider } from "@/components/quiz-kit/motion";
import { GuestJoinForm, RejoinForm, validateDisplayName } from "@/features/quiz-play/components/join-forms";
import { ApiError } from "@/lib/api/errors";
import { I18nProvider } from "@/lib/i18n/provider";
import type { LiveRoomInfo } from "@/types/api/live";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

const fetchMocks = vi.hoisted(() => ({
  joinRoom: vi.fn(),
  rejoinRoom: vi.fn(),
  suggestName: vi.fn(),
  computeDeviceHash: vi.fn()
}));

vi.mock("@/features/quiz-live/lib/live-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/quiz-live/lib/live-fetch")>();
  return { ...actual, ...fetchMocks };
});

const room: LiveRoomInfo = {
  session_id: "s1",
  code: "482913",
  title: "Redes",
  status: "lobby",
  phase: "lobby",
  allow_guests: true,
  requires_login: false,
  accepting_joins: true,
  theme_key: "sentinel",
  participant_count: 3,
  consent_version: "2026-09"
};

const joinResult = {
  session_id: "s1",
  participant_id: "p1",
  token: "tok",
  expires_at: "2099-01-01T00:00:00Z",
  return_code: "K7Q2MX",
  display_name: "Ana",
  avatar_seed: "seed"
};

function wrap(node: ReactNode) {
  return (
    <I18nProvider locale="en-US" localeFromCookie>
      <LiveMotionProvider>
        <div data-lq-theme="sentinel">{node}</div>
      </LiveMotionProvider>
    </I18nProvider>
  );
}

beforeEach(() => {
  fetchMocks.joinRoom.mockReset();
  fetchMocks.rejoinRoom.mockReset();
  fetchMocks.suggestName.mockReset();
  fetchMocks.computeDeviceHash.mockReset().mockResolvedValue("devhash");
});

afterEach(() => cleanup());

describe("validateDisplayName", () => {
  it("enforces 2–24 characters after normalization", () => {
    expect(validateDisplayName(" a ")).toBe("short");
    expect(validateDisplayName("Ana")).toBeNull();
    expect(validateDisplayName("x".repeat(25))).toBe("long");
  });
});

describe("GuestJoinForm", () => {
  it("shows the LGPD consent with its version and a sign-in link carrying next", () => {
    render(wrap(<GuestJoinForm code="482913" room={room} onJoined={vi.fn()} onWantRejoin={vi.fn()} />));
    expect(screen.getByText(/terms 2026-09/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Sign in with my account" });
    expect(link.getAttribute("href")).toBe("/login?next=%2Fj%2F482913");
  });

  it("validates the name and the consent before calling the API", async () => {
    render(wrap(<GuestJoinForm code="482913" room={room} onJoined={vi.fn()} onWantRejoin={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: "Join the room" }));
    expect(await screen.findByText("Use at least 2 characters.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Join the room" }));
    expect(await screen.findByText("Tick the consent box to join.")).toBeTruthy();
    expect(fetchMocks.joinRoom).not.toHaveBeenCalled();
  });

  it("suggests a name", async () => {
    fetchMocks.suggestName.mockResolvedValue({ name: "Swift Firewall" });
    render(wrap(<GuestJoinForm code="482913" room={room} onJoined={vi.fn()} onWantRejoin={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: "Suggest a name" }));
    await waitFor(() => expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Swift Firewall"));
    expect(fetchMocks.suggestName).toHaveBeenCalledWith("en");
  });

  it("joins with consent, avatar seed and device hash", async () => {
    fetchMocks.joinRoom.mockResolvedValue(joinResult);
    const onJoined = vi.fn();
    render(wrap(<GuestJoinForm code="482913" room={room} onJoined={onJoined} onWantRejoin={vi.fn()} />));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "  Ana  " } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Join the room" }));
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(joinResult));
    const [code, body] = fetchMocks.joinRoom.mock.calls[0];
    expect(code).toBe("482913");
    expect(body).toMatchObject({ display_name: "Ana", consent: true, dev_h: "devhash" });
    expect(typeof body.avatar_seed).toBe("string");
  });

  it("maps join errors to friendly copy and offers the return code on name_taken", async () => {
    fetchMocks.joinRoom.mockRejectedValue(new ApiError({ code: "name_taken", message: "taken", status: 409 }));
    const onWantRejoin = vi.fn();
    render(wrap(<GuestJoinForm code="482913" room={room} onJoined={vi.fn()} onWantRejoin={onWantRejoin} />));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Join the room" }));
    expect(await screen.findByText(/Someone already uses that name/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "I joined before and have a return code" })[0]);
    expect(onWantRejoin).toHaveBeenCalled();
  });

  it("shows the room-locked message", async () => {
    fetchMocks.joinRoom.mockRejectedValue(new ApiError({ code: "room_locked", message: "locked", status: 423 }));
    render(wrap(<GuestJoinForm code="482913" room={room} onJoined={vi.fn()} onWantRejoin={vi.fn()} />));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Join the room" }));
    expect(await screen.findByText(/The presenter locked the room/)).toBeTruthy();
  });
});

describe("RejoinForm", () => {
  it("sends name + upper-cased return code and reports invalid codes", async () => {
    fetchMocks.rejoinRoom.mockRejectedValueOnce(new ApiError({ code: "invalid_return_code", message: "no", status: 403 }));
    const onJoined = vi.fn();
    render(wrap(<RejoinForm code="482913" onJoined={onJoined} />));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Return code"), { target: { value: "k7q2mx" } });
    fireEvent.click(screen.getByRole("button", { name: "Back to the room" }));
    expect(await screen.findByText(/does not match/)).toBeTruthy();
    expect(fetchMocks.rejoinRoom).toHaveBeenCalledWith("482913", { display_name: "Ana", return_code: "K7Q2MX" });
  });
});
