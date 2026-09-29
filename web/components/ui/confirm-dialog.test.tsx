// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";

afterEach(() => cleanup());

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Delete question?"
      message="This cannot be undone."
      confirmLabel="Delete"
      cancelLabel="Keep"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("is labelled by its title and described by its message", () => {
    renderDialog();
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.hasAttribute("open")).toBe(true);
    const title = document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "");
    const message = document.getElementById(dialog?.getAttribute("aria-describedby") ?? "");
    expect(title?.textContent).toBe("Delete question?");
    expect(message?.textContent).toBe("This cannot be undone.");
  });

  it("calls onConfirm / onCancel from the buttons", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Keep"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("treats Esc (the dialog cancel event) as cancel, except while busy", () => {
    const { onCancel } = renderDialog();
    fireEvent(document.querySelector("dialog") as HTMLDialogElement, new Event("cancel", { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    cleanup();

    const busy = renderDialog({ busy: true });
    fireEvent(document.querySelector("dialog") as HTMLDialogElement, new Event("cancel", { cancelable: true }));
    expect(busy.onCancel).not.toHaveBeenCalled();
    expect((screen.getByText("Keep") as HTMLButtonElement).disabled).toBe(true);
  });
});

function ConfirmHarness({ onResult }: { onResult: (value: boolean) => void }) {
  const { confirm, dialog } = useConfirm();
  const [asked, setAsked] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          setAsked((count) => count + 1);
          onResult(await confirm({ title: "Change role?", message: "Permissions change now.", confirmLabel: "Change" }));
        }}
      >
        ask {asked}
      </button>
      {dialog}
    </>
  );
}

describe("useConfirm", () => {
  it("resolves true on confirm and false on cancel", async () => {
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} />);

    fireEvent.click(screen.getByText(/^ask/));
    expect(screen.getByText("Change role?")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("Change"));
    });
    expect(onResult).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByText(/^ask/));
    await act(async () => {
      fireEvent.click(screen.getByText("Cancel"));
    });
    expect(onResult).toHaveBeenLastCalledWith(false);
    expect(onResult).toHaveBeenCalledTimes(2);
  });
});
