// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Field } from "@/components/ui/field";

afterEach(() => cleanup());

describe("Field", () => {
  it("links the label and the hint without marking the control invalid", () => {
    render(
      <Field label="E-mail" htmlFor="email" hint="Use your work address" hintMode="inline">
        <input id="email" />
      </Field>
    );
    const input = screen.getByRole("textbox", { name: "E-mail" });
    expect(input.getAttribute("aria-describedby")).toBe("email-hint");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(document.getElementById("email-hint")?.textContent).toBe("Use your work address");
  });

  it("adds the error to aria-describedby, sets aria-invalid and announces it", () => {
    render(
      <Field label="E-mail" htmlFor="email" hint="Use your work address" error="Invalid e-mail">
        <input id="email" aria-describedby="external-help" />
      </Field>
    );
    const input = screen.getByRole("textbox", { name: "E-mail" });
    expect(input.getAttribute("aria-describedby")?.split(" ")).toEqual(["external-help", "email-hint", "email-error"]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const alert = screen.getByRole("alert");
    expect(alert.id).toBe("email-error");
    expect(alert.textContent).toBe("Invalid e-mail");
  });

  it("omits aria-describedby when there is neither hint nor error", () => {
    render(
      <Field label="Name" htmlFor="name" hintMode="none" hint="ignored">
        <input id="name" />
      </Field>
    );
    const input = screen.getByLabelText("Name");
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  it("toggles the tooltip hint with an aria-expanded button", () => {
    render(
      <Field label="Password" htmlFor="password" hint="At least 12 characters">
        <input id="password" type="password" />
      </Field>
    );
    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("password-hint");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("password-hint")?.hasAttribute("data-visible")).toBe(true);
  });
});
