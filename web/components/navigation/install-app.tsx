"use client";

import { useState, type ComponentType, type SVGProps } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DownloadIcon, PlusSquareIcon, ShareIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n";
import { useInstallApp } from "@/lib/pwa/install";
import { cn } from "@/lib/utils/cn";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
const STEP_ICONS: Icon[] = [ShareIcon, PlusSquareIcon, DownloadIcon];

/** Manual steps for browsers without an install API (iOS Share sheet, Safari "Add to Dock"). */
function InstallStepsDialog({ platform, open, onClose }: { platform: "ios" | "mac"; open: boolean; onClose: () => void }) {
  const { messages, t } = useI18n();
  const copy = messages.navigation.install[platform];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.title}
      description={copy.intro}
      footer={<Button onClick={onClose}>{t("navigation.install.done")}</Button>}
    >
      <ol className="flex flex-col gap-3">
        {copy.steps.map((step, index) => {
          const StepIcon = STEP_ICONS[index] ?? DownloadIcon;
          return (
            <li key={step} className="flex items-start gap-3 text-sm text-fg">
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
                <StepIcon size={18} />
              </span>
              <span className="pt-1.5">
                <span className="nums mr-1 font-semibold">{index + 1}.</span>
                {step}
              </span>
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}

/**
 * "Install app" entry point: opens the browser's install dialog (Edge, Chrome, Android) or shows
 * the Add-to-Home-Screen steps (iOS, Safari on macOS). Renders nothing once installed, or when the
 * browser has no install path.
 *
 * - `card`: full-width row with a hint (sidebar and mobile menu).
 * - `compact`: small button (mobile top bar).
 */
export function InstallAppButton({ variant = "card", className }: { variant?: "card" | "compact"; className?: string }) {
  const { t } = useI18n();
  const { mode, install } = useInstallApp();
  const [stepsOpen, setStepsOpen] = useState(false);

  if (mode === "installed" || mode === "unavailable") {
    return null;
  }

  function handleClick() {
    if (mode === "prompt") {
      void install();
    } else {
      setStepsOpen(true);
    }
  }

  const dialog =
    mode === "ios" || mode === "safari-mac" ? (
      <InstallStepsDialog platform={mode === "ios" ? "ios" : "mac"} open={stepsOpen} onClose={() => setStepsOpen(false)} />
    ) : null;

  if (variant === "compact") {
    return (
      <>
        <Button variant="secondary" size="sm" onClick={handleClick} className={className}>
          <DownloadIcon />
          {t("navigation.install.actionShort")}
        </Button>
        {dialog}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "focus-ring flex w-full items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-surface-raised",
          className
        )}
      >
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
          <DownloadIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-fg">{t("navigation.install.action")}</span>
          <span className="block text-xs text-fg-muted">{t("navigation.install.hint")}</span>
        </span>
      </button>
      {dialog}
    </>
  );
}
