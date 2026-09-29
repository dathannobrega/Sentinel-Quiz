"use client";

import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
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
      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard" className={buttonClassName("primary", "lg")}>
          {t("common.actions.goToDashboard")}
        </Link>
        <Link href="/start" className={buttonClassName("secondary", "lg")}>
          {t("common.actions.newSession")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/register" className={buttonClassName("primary", "lg")}>
        {t("common.actions.startFree")}
      </Link>
      {variant === "hero" ? (
        <a href="#como-funciona" className={buttonClassName("secondary", "lg")}>
          {t("common.actions.seeDemo")}
        </a>
      ) : (
        <Link href="/login" className={buttonClassName("secondary", "lg")}>
          {t("common.actions.alreadyHaveAccount")}
        </Link>
      )}
    </div>
  );
}
