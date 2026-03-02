import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type BannerTone = "neutral" | "success" | "warning" | "danger";

const toneStyles: Record<BannerTone, { background: string; border: string; color: string }> = {
  neutral: {
    background: "rgba(255,255,255,0.78)",
    border: "1px solid var(--sq-border)",
    color: "var(--sq-text)"
  },
  success: {
    background: "rgba(15,157,88,0.08)",
    border: "1px solid rgba(15,157,88,0.16)",
    color: "var(--sq-success)"
  },
  warning: {
    background: "rgba(217,119,6,0.08)",
    border: "1px solid rgba(217,119,6,0.18)",
    color: "var(--sq-warning)"
  },
  danger: {
    background: "rgba(209,67,67,0.08)",
    border: "1px solid rgba(209,67,67,0.18)",
    color: "var(--sq-danger)"
  }
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
  const palette = toneStyles[tone];

  return (
    <div
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      className={cn(className)}
      style={{
        ...palette,
        borderRadius: "var(--sq-radius-md)",
        padding: "var(--sq-space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sq-space-3)"
      }}
    >
      <div>
        {title ? <strong style={{ display: "block", marginBottom: "var(--sq-space-1)" }}>{title}</strong> : null}
        <span style={{ color: "var(--sq-text)" }}>{message}</span>
      </div>
      {action ? <div className="sq-inline-actions">{action}</div> : null}
    </div>
  );
}
