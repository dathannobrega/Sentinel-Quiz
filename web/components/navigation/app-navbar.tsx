"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useLogoutMutation, useSessionRole } from "@/lib/query/hooks";

function isDashboardPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/dashboard";
}

function shouldHideNavbar(pathname: string): boolean {
  return pathname.startsWith("/exam/") || pathname.startsWith("/study/");
}

export function AppNavbar() {
  const { availableLocales, locale, setLocale, t } = useI18n();
  const pathname = usePathname() || "/";
  const router = useRouter();
  const hidden = shouldHideNavbar(pathname);
  const { user: currentUser, isStaff, query } = useSessionRole();
  const logoutMutation = useLogoutMutation();
  const [navNotice, setNavNotice] = useState<string | null>(null);

  const isSessionLoading = query.isPending && !hidden;
  const sessionError = query.isError ? readErrorMessage(query.error, t("navigation.errors.sessionRefresh")) : null;

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
    if (isStaff) {
      baseLinks.push({ href: "/admin", label: t("common.labels.admin") });
    }
    return baseLinks;
  }, [currentUser, isStaff, pathname, t]);

  function handleLogout() {
    setNavNotice(null);
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        router.push("/login");
        router.refresh();
      },
      onError: (error) => {
        setNavNotice(readErrorMessage(error, t("navigation.errors.sessionRefresh")));
      }
    });
  }

  if (hidden) {
    return null;
  }

  const notice = navNotice || sessionError;

  return (
    <nav className="sq-global-nav" aria-label={t("navigation.ariaLabel")}>
      <div className="sq-global-nav__inner">
        <div className="sq-brand">
          <div className="sq-logo" aria-hidden="true">
            SQ
          </div>
          <div className="sq-brand-copy">
            <div className="sq-page-title">{t("navigation.brandTitle")}</div>
            <p className="sq-page-subtitle">{t("navigation.brandSubtitle")}</p>
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
                    lang={item}
                    className={`sq-locale-switch__button${active ? " sq-locale-switch__button--active" : ""}`}
                    aria-pressed={active}
                    aria-label={title}
                    title={title}
                    onClick={() => setLocale(item)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {isSessionLoading ? (
              <span className="sq-chip" role="status">
                {t("common.status.syncingSession")}
              </span>
            ) : null}

            {!isSessionLoading && currentUser ? (
              <>
                <span className="sq-chip">
                  {currentUser.display_name || currentUser.email} · {currentUser.role}
                </span>
                <Button variant="ghost" size="sm" busy={logoutMutation.isPending} onClick={handleLogout}>
                  {t("common.actions.signOut")}
                </Button>
              </>
            ) : null}

            {!isSessionLoading && !currentUser ? (
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

      {notice ? (
        <div className="sq-global-nav__notice" role="status">
          {notice}
          {sessionError && !navNotice ? (
            <>
              {" "}
              <button type="button" className="sq-text-link" onClick={() => void query.refetch()}>
                {t("common.actions.retry")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
