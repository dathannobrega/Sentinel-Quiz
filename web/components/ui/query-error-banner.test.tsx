// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { ApiError } from "@/lib/api/errors";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

const { t } = createTranslator(getMessages("en-US"));

function withI18n(node: ReactNode) {
  return (
    <I18nProvider locale="en-US" localeFromCookie>
      {node}
    </I18nProvider>
  );
}

afterEach(() => cleanup());

describe("QueryErrorBanner", () => {
  it("shows the API error message and calls refetch when retry is clicked", () => {
    const refetch = vi.fn();
    const error = new ApiError({ code: "http_500", message: "Backend exploded.", status: 500 });
    render(withI18n(<QueryErrorBanner error={error} title="Could not load users" onRetry={refetch} />));

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not load users");
    expect(alert.textContent).toContain("Backend exploded.");

    fireEvent.click(screen.getByRole("button", { name: t("system.loadFailed.retry") }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("disables the retry button while retrying", () => {
    const refetch = vi.fn();
    render(withI18n(<QueryErrorBanner error={new Error("boom")} onRetry={refetch} retrying />));
    const button = screen.getByRole("button");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("renders no retry button without onRetry", () => {
    render(withI18n(<QueryErrorBanner error={new Error("boom")} />));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(t("system.loadFailed.title"));
  });
});
