import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type BannerTone = "neutral" | "success" | "warning" | "danger";

const toneClasses: Record<BannerTone, string> = {
  neutral: "sq-status-banner--neutral",
  success: "sq-status-banner--success",
  warning: "sq-status-banner--warning",
  danger: "sq-status-banner--danger"
};

interface StatusBannerProps {
  tone?: BannerTone;
  title?: string;
  message: string;
  action?: ReactNode;
  role?: "status" | "alert";
  className?: string;
}

export function StatusBanner({
  tone = "neutral",
  title,
  message,
  action,
  role = "status",
  className
}: StatusBannerProps) {
  return (
    <div
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      className={cn("sq-status-banner", toneClasses[tone], className)}
    >
      <div className="sq-status-banner__body">
        {title ? <strong className="sq-status-banner__title">{title}</strong> : null}
        <span className="sq-status-banner__message">{message}</span>
      </div>
      {action ? <div className="sq-inline-actions">{action}</div> : null}
    </div>
  );
}
