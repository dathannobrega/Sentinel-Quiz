"use client";

import Link from "next/link";

import { useI18n } from "@/lib/i18n";
import { useCurrentUser } from "@/lib/query/hooks";

/**
 * The only auth-dependent part of the landing page. The rest is server-rendered immediately;
 * this island swaps the CTA once /auth/me resolves (shared ["current-user"] cache).
 */
export function LandingAuthCta({ variant }: { variant: "hero" | "footer" }) {
  const { t } = useI18n();
  const currentUserQuery = useCurrentUser();
  const user = currentUserQuery.data ?? null;

  if (user) {
    return (
      <div className="sq-actions">
        <Link href="/dashboard" className="sq-button sq-button--md sq-button--primary">
          {t("common.actions.goToDashboard")}
        </Link>
        <Link href="/start" className="sq-button sq-button--md sq-button--ghost">
          {t("common.actions.newSession")}
        </Link>
      </div>
    );
  }

  return (
    <div className="sq-actions">
      <Link href="/register" className="sq-button sq-button--md sq-button--primary">
        {t("common.actions.startFree")}
      </Link>
      {variant === "hero" ? (
        <a href="#como-funciona" className="sq-button sq-button--md sq-button--ghost">
          {t("common.actions.seeDemo")}
        </a>
      ) : (
        <Link href="/login" className="sq-button sq-button--md sq-button--ghost">
          {t("common.actions.alreadyHaveAccount")}
        </Link>
      )}
    </div>
  );
}
