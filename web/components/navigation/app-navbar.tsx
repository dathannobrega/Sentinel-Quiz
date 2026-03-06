"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { fetchCurrentUser, logoutUser } from "@/lib/auth/session";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { useI18n } from "@/lib/i18n";
import type { AuthUser } from "@/types/api";

function readNavError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function isDashboardPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/dashboard";
}

function shouldHideNavbar(pathname: string): boolean {
  return pathname.startsWith("/exam/") || pathname.startsWith("/study/");
}

export function AppNavbar() {
  const { availableLocales, locale, setLocale, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [sessionState, setSessionState] = useState<"loading" | "ready">("loading");
  const [pendingAction, setPendingAction] = useState<"logout" | null>(null);
  const [navNotice, setNavNotice] = useState<string | null>(null);

  const syncSession = useEffectEvent(async () => {
    setSessionState("loading");
    setNavNotice(null);
    try {
      setCurrentUser(await fetchCurrentUser());
    } catch (error) {
      setCurrentUser(null);
      setNavNotice(readNavError(error, t("navigation.errors.sessionRefresh")));
    } finally {
      setSessionState("ready");
    }
  });

  useEffect(() => {
    if (shouldHideNavbar(pathname)) {
      return;
    }
    void syncSession();
  }, [pathname, syncSession]);

  const links = useMemo(() => {
    if (!currentUser && pathname === "/") {
      return [
        { href: "/#como-funciona", label: t("navigation.publicLinks.howItWorks") },
        { href: "/#faq", label: t("navigation.publicLinks.faq") }
      ];
    }
    const baseLinks = [
      { href: "/dashboard", label: t("common.labels.dashboard") },
      { href: "/start", label: t("common.labels.start") },
      { href: "/review", label: t("common.labels.review") },
      { href: "/history", label: t("common.labels.history") },
      { href: "/settings", label: t("common.labels.settings") }
    ];
    if (currentUser?.role === "admin") {
      baseLinks.push({ href: "/admin", label: t("common.labels.admin") });
    }
    return baseLinks;
  }, [currentUser, pathname, t]);

  async function handleLogout() {
    setPendingAction("logout");
    setNavNotice(null);
    try {
      await logoutUser();
      setCurrentUser(null);
      router.push("/login");
      router.refresh();
    } catch (error) {
      setNavNotice(readNavError(error, t("navigation.errors.sessionRefresh")));
    } finally {
      setPendingAction(null);
    }
  }

  if (shouldHideNavbar(pathname)) {
    return null;
  }

  return (
    <nav className="sq-global-nav" aria-label={t("navigation.ariaLabel")}>
      <div className="sq-global-nav__inner">
        <div className="sq-brand">
          <div className="sq-logo" aria-hidden="true">
            SQ
          </div>
          <div className="sq-brand-copy">
            <div className="sq-page-title">{t("navigation.brandTitle")}</div>
            <p className="sq-page-subtitle">
              {t("navigation.brandSubtitle")}
            </p>
          </div>
        </div>

        <div className="sq-nav-cluster">
          <div className="sq-nav-links">
            {links.map((link) => {
              const active =
                link.href === "/dashboard"
                  ? isDashboardPath(pathname)
                  : link.href.includes("#")
                    ? false
                  : pathname === link.href || pathname.startsWith(`${link.href}/`);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`sq-nav-link${active ? " sq-nav-link--active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="sq-nav-account">
            <div className="sq-locale-switch" role="group" aria-label={t("navigation.locale.label")}>
              {availableLocales.map((item) => {
                const active = item === locale;
                const label = item === "pt-BR" ? t("navigation.locale.ptBR") : t("navigation.locale.enUS");
                const title = item === "pt-BR" ? t("navigation.locale.switchToPtBR") : t("navigation.locale.switchToEnUS");

                return (
                  <button
                    key={item}
                    type="button"
                    className={`sq-locale-switch__button${active ? " sq-locale-switch__button--active" : ""}`}
                    aria-pressed={active}
                    title={title}
                    onClick={() => setLocale(item)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {sessionState === "loading" ? <span className="sq-chip">{t("common.status.syncingSession")}</span> : null}

            {sessionState === "ready" && currentUser ? (
              <>
                <span className="sq-chip">
                  {currentUser.display_name || currentUser.email} · {currentUser.role}
                </span>
                <Button variant="ghost" size="sm" busy={pendingAction === "logout"} onClick={() => void handleLogout()}>
                  {t("common.actions.signOut")}
                </Button>
              </>
            ) : null}

            {sessionState === "ready" && !currentUser ? (
              <>
                <Link href="/login" className="sq-nav-link">
                  {t("common.actions.signIn")}
                </Link>
                <Link href="/register" className="sq-button sq-button--sm sq-button--primary">
                  {t("common.actions.createAccount")}
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {navNotice ? <div className="sq-global-nav__notice">{navNotice}</div> : null}
    </nav>
  );
}
