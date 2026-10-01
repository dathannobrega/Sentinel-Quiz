// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { WaitingRoomState } from "@/features/quiz-live/lib/protocol";
import { WaitingRoomPanel, type WaitingRoomActions } from "@/features/quiz-present/components/waiting-room-panel";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

afterEach(() => cleanup());

const now = new Date().toISOString();
const room: WaitingRoomState = {
  require_approval: true,
  max_participants: 100,
  platform_max: 2000,
  approval_count: 2,
  capacity_count: 3,
  approval: [
    { request_id: "r1", display_name: "Ana", avatar_seed: "a", signed_in: true, created_at: now, connected: true },
    { request_id: "r2", display_name: "Bia", avatar_seed: "b", signed_in: false, created_at: now, connected: false }
  ]
};

function show(state: WaitingRoomState = room, participantCount = 40) {
  const actions: WaitingRoomActions = { admit: vi.fn(), reject: vi.fn(), setCapacity: vi.fn(), setApproval: vi.fn() };
  render(
    <I18nProvider locale="pt-BR" localeFromCookie>
      <div data-lq-theme="sentinel">
        <WaitingRoomPanel room={state} participantCount={participantCount} actions={actions} />
      </div>
    </I18nProvider>
  );
  return actions;
}

describe("WaitingRoomPanel", () => {
  it("approves, rejects and approves everyone awaiting approval", () => {
    const actions = show();
    fireEvent.click(screen.getByRole("button", { name: "Aprovar a entrada de Ana" }));
    expect(actions.admit).toHaveBeenCalledWith(["r1"]);
    // A decision hides the person at once (the next snapshot confirms it).
    expect(screen.queryByRole("button", { name: "Aprovar a entrada de Ana" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recusar a entrada de Bia" }));
    expect(actions.reject).toHaveBeenCalledWith("r2");
    cleanup();
    const again = show();
    fireEvent.click(screen.getByRole("button", { name: /Aprovar todos \(2\)/ }));
    expect(again.admit).toHaveBeenCalledWith("all");
  });

  it("shows the capacity queue and changes the cap within the platform's", () => {
    const actions = show();
    expect(screen.getByText("3 pessoas na fila")).toBeTruthy();
    const input = screen.getByLabelText("Máximo de participantes") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2500" } });
    expect(screen.getByText("Use um número inteiro de 1 a 2.000.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar teto" }));
    expect(actions.setCapacity).toHaveBeenCalledWith(150);
  });

  it("turns approval off", () => {
    const actions = show();
    fireEvent.click(screen.getByRole("switch", { name: /Aprovar a entrada/ }));
    expect(actions.setApproval).toHaveBeenCalledWith(false);
  });
});
