// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WaitingTicket } from "@/features/quiz-live/lib/live-fetch";
import { WaitingRoomScreen } from "@/features/quiz-play/components/waiting-room";
import { I18nProvider } from "@/lib/i18n/provider";

const queue = vi.hoisted(() => ({ getQueueStatus: vi.fn(), leaveQueue: vi.fn() }));

vi.mock("@/features/quiz-live/lib/live-fetch", async (original) => ({
  ...(await original<typeof import("@/features/quiz-live/lib/live-fetch")>()),
  getQueueStatus: queue.getQueueStatus,
  leaveQueue: queue.leaveQueue
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

const ticket: WaitingTicket = {
  requestId: "r1",
  waitToken: "wait-secret",
  sessionId: "s1",
  displayName: "Ana",
  avatarSeed: "abc",
  reason: "capacity",
  position: 3,
  waiting: 40,
  retryAfterMs: 3000
};

beforeEach(() => {
  vi.useFakeTimers();
  queue.getQueueStatus.mockReset();
  queue.leaveQueue.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function show(current: WaitingTicket = ticket) {
  const handlers = { onAdmitted: vi.fn(), onLeft: vi.fn(), onRetry: vi.fn() };
  render(
    <I18nProvider locale="pt-BR" localeFromCookie>
      <div data-lq-theme="sentinel">
        <WaitingRoomScreen code="482913" ticket={current} {...handlers} />
      </div>
    </I18nProvider>
  );
  return handlers;
}

describe("WaitingRoomScreen", () => {
  it("shows the place in the full room's queue and leaves on demand", async () => {
    queue.leaveQueue.mockResolvedValue({ status: "withdrawn", request_id: "r1" });
    const handlers = show();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("A sala está cheia")).toBeTruthy();
    expect(screen.getByText("Você é o nº 3 da fila")).toBeTruthy();
    expect(screen.getByText("40 pessoas esperando")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sair da fila" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(queue.leaveQueue).toHaveBeenCalledWith("r1", "wait-secret");
    expect(handlers.onLeft).toHaveBeenCalled();
  });

  it("explains the approval wait and the rejection, with a retry", async () => {
    queue.getQueueStatus.mockResolvedValueOnce({ status: "rejected", request_id: "r1", session_id: "s1" });
    const handlers = show({ ...ticket, reason: "approval", position: null });
    expect(screen.getByText("Aguardando o apresentador liberar a entrada")).toBeTruthy();
    expect(screen.queryByText(/^Você é o/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3600); // the 202's pace plus at most 20% jitter
    });
    expect(screen.getByText("Entrada não liberada")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(handlers.onRetry).toHaveBeenCalled();
  });
});
