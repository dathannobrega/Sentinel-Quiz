// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { WordModerationPanel } from "@/features/quiz-present/components/word-moderation";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

afterEach(() => cleanup());

const cloud = { words: [{ text: "MFA", key: "mfa", n: 2 }, { text: "Senha", key: "senha", n: 5 }], distinct: 3, filtered: 1 };

function show(hidden: string[], onToggle = vi.fn()) {
  render(
    <I18nProvider locale="pt-BR" localeFromCookie>
      <div data-lq-theme="sentinel">
        <WordModerationPanel cloud={cloud} hidden={hidden} onToggle={onToggle} />
      </div>
    </I18nProvider>
  );
  return onToggle;
}

describe("WordModerationPanel", () => {
  it("lists the words (most sent first) with Hide, and the server's hidden keys with Show", () => {
    const onToggle = show(["seguranca"]);
    expect(screen.getByText("3 palavras diferentes · 1 fora da tela (filtro ou ocultadas)")).toBeTruthy();
    const visible = screen.getByRole("list", { name: "Palavras na tela" });
    expect(visible.textContent).toMatch(/^Senha.*MFA/);
    fireEvent.click(screen.getByRole("button", { name: "Ocultar “MFA” da nuvem" }));
    expect(onToggle).toHaveBeenCalledWith("mfa", true);
    // Hidden words are shown by their normalized key, as the server sends them.
    expect(screen.getByText("seguranca")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar “seguranca” de novo" }));
    expect(onToggle).toHaveBeenCalledWith("seguranca", false);
  });

  it("keeps a hidden word out of the visible list even if a stale cloud still has it", () => {
    show(["mfa"]);
    expect(screen.queryByRole("button", { name: "Ocultar “MFA” da nuvem" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mostrar “mfa” de novo" })).toBeTruthy();
  });
});
