import type { ReactNode } from "react";

import { AlertIcon, CircleCheckIcon, CircleXIcon, InfoIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils/cn";

export type AlertTone = "neutral" | "success" | "warning" | "danger";

const tones: Record<AlertTone, { box: string; icon: string; Icon: typeof InfoIcon }> = {
  neutral: { box: "border-line bg-surface-muted", icon: "text-fg-muted", Icon: InfoIcon },
  success: { box: "border-success/30 bg-success-soft", icon: "text-success", Icon: CircleCheckIcon },
  warning: { box: "border-warning/30 bg-warning-soft", icon: "text-warning", Icon: AlertIcon },
  danger: { box: "border-danger/30 bg-danger-soft", icon: "text-danger", Icon: CircleXIcon }
};

interface AlertProps {
  tone?: AlertTone;
  title?: string;
  message: ReactNode;
  action?: ReactNode;
  role?: "status" | "alert";
  className?: string;
}

/** Inline message. Tone is carried by icon + title + color together (never color alone). */
export function Alert({ tone = "neutral", title, message, action, role = "status", className }: AlertProps) {
  const { box, icon, Icon } = tones[tone];
  return (
    <div
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-4 py-3 text-sm", box, className)}
    >
      <Icon size={18} className={cn("mt-px shrink-0", icon)} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold text-fg">{title}</p> : null}
        <p className={cn("leading-relaxed", title ? "text-fg-muted" : "text-fg")}>{message}</p>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:pl-7">{action}</div> : null}
    </div>
  );
}
