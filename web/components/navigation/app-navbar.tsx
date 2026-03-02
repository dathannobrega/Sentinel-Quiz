"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { fetchCurrentUser, logoutUser } from "@/lib/auth/session";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import type { AuthUser } from "@/types/api";

function readNavError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Nao foi possivel atualizar a sessao.";
}

function isDashboardPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/dashboard";
}

function shouldHideNavbar(pathname: string): boolean {
  return pathname.startsWith("/exam/") || pathname.startsWith("/study/");
}

export function AppNavbar() {
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
      setNavNotice(readNavError(error));
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
    const baseLinks = [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/history", label: "Historico" }
    ];
    if (currentUser?.role === "admin") {
      baseLinks.push({ href: "/admin", label: "Admin" });
    }
    return baseLinks;
  }, [currentUser]);

  async function handleLogout() {
    setPendingAction("logout");
    setNavNotice(null);
    try {
      await logoutUser();
      setCurrentUser(null);
      router.push("/login");
      router.refresh();
    } catch (error) {
      setNavNotice(readNavError(error));
    } finally {
      setPendingAction(null);
    }
  }

  if (shouldHideNavbar(pathname)) {
    return null;
  }

  return (
    <nav className="sq-global-nav" aria-label="Navegacao principal">
      <div className="sq-global-nav__inner">
        <div className="sq-brand">
          <div className="sq-logo" aria-hidden="true">
            SQ
          </div>
          <div className="sq-brand-copy">
            <div className="sq-page-title">Sentinel Quiz</div>
            <p className="sq-page-subtitle">
              Plataforma de estudo, simulados e governanca editorial em uma unica interface.
            </p>
          </div>
        </div>

        <div className="sq-nav-cluster">
          <div className="sq-nav-links">
            {links.map((link) => {
              const active =
                link.href === "/dashboard"
                  ? isDashboardPath(pathname)
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
            {sessionState === "loading" ? <span className="sq-chip">Sincronizando sessao...</span> : null}

            {sessionState === "ready" && currentUser ? (
              <>
                <span className="sq-chip">
                  {currentUser.display_name || currentUser.email} · {currentUser.role}
                </span>
                <Button variant="ghost" size="sm" busy={pendingAction === "logout"} onClick={() => void handleLogout()}>
                  Sair
                </Button>
              </>
            ) : null}

            {sessionState === "ready" && !currentUser ? (
              <>
                <Link href="/login" className="sq-nav-link">
                  Entrar
                </Link>
                <Link href="/register" className="sq-button sq-button--sm sq-button--primary">
                  Criar conta
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
