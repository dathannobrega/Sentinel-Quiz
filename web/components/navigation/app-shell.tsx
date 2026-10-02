"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { InstallAppButton } from "@/components/navigation/install-app";
import { buttonClassName } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  HomeIcon,
  ListIcon,
  LogOutIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  PlayCircleIcon,
  RepeatIcon,
  SettingsIcon,
  ShieldIcon,
  SunIcon
} from "@/components/ui/icons";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useLogoutMutation, useSessionRole } from "@/lib/query/hooks";
import { useTheme, type ThemePreference } from "@/lib/theme/theme";
import { cn } from "@/lib/utils/cn";

type Chrome = "app" | "public" | "none";

const PUBLIC_PATHS = new Set(["/", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email"]);

/** Sentinel Arena: the projector stage and the participant phone screens (live `/j`, challenge `/q`). */
function isLivePath(pathname: string): boolean {
  return /^\/(present|j|q)(\/|$)/.test(pathname);
}

/** Runner screens own the whole viewport (focus). Result pages keep the app chrome. */
function resolveChrome(pathname: string): Chrome {
  if (/^\/(exam|study)\/[^/]+\/?$/.test(pathname)) {
    return "none";
  }
  // Live screens own the whole viewport.
  if (isLivePath(pathname)) {
    return "none";
  }
  return PUBLIC_PATHS.has(pathname) ? "public" : "app";
}

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
interface NavItem {
  href: string;
  label: string;
  icon: Icon;
}

function isActive(pathname: string, href: string): boolean {
  if (href.includes("#")) {
    return false;
  }
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Wordmark with the product's mark: a filled answer-sheet bubble. */
export function BrandMark({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden="true" className="grid size-6 place-items-center rounded-full border-2 border-fg">
        <span className="size-2.5 rounded-full bg-primary" />
      </span>
      <span className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-fg">{t("navigation.brandTitle")}</span>
    </span>
  );
}

function ThemeSwitch({ className }: { className?: string }) {
  const { t } = useI18n();
  const { preference, setPreference } = useTheme();
  const options: Array<{ value: ThemePreference; label: string; icon: Icon }> = [
    { value: "light", label: t("navigation.theme.light"), icon: SunIcon },
    { value: "dark", label: t("navigation.theme.dark"), icon: MoonIcon },
    { value: "system", label: t("navigation.theme.system"), icon: MonitorIcon }
  ];
  return (
    <div role="group" aria-label={t("navigation.theme.label")} className={cn("inline-flex rounded-md bg-surface-muted p-0.5", className)}>
      {options.map(({ value, label, icon: ItemIcon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => setPreference(value)}
            className={cn(
              "focus-ring inline-grid h-8 w-9 place-items-center rounded-[5px] transition-colors",
              active ? "bg-surface text-fg shadow-raised" : "text-fg-muted hover:text-fg"
            )}
          >
            <ItemIcon />
          </button>
        );
      })}
    </div>
  );
}

function LocaleSwitch({ className }: { className?: string }) {
  const { availableLocales, locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t("navigation.locale.label")} className={cn("inline-flex rounded-md bg-surface-muted p-0.5", className)}>
      {availableLocales.map((item) => {
        const active = item === locale;
        const label = item === "pt-BR" ? t("navigation.locale.ptBR") : t("navigation.locale.enUS");
        const title = item === "pt-BR" ? t("navigation.locale.switchToPtBR") : t("navigation.locale.switchToEnUS");
        return (
          <button
            key={item}
            type="button"
            lang={item}
            aria-pressed={active}
            aria-label={title}
            title={title}
            onClick={() => setLocale(item)}
            className={cn(
              "focus-ring h-8 rounded-[5px] px-2.5 text-xs font-semibold tracking-wide transition-colors",
              active ? "bg-surface text-fg shadow-raised" : "text-fg-muted hover:text-fg"
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function useNavItems(): { study: NavItem[]; manage: NavItem[] } {
  const { t } = useI18n();
  const { isStaff } = useSessionRole();
  return useMemo(() => {
    const manage: NavItem[] = [{ href: "/settings", label: t("common.labels.settings"), icon: SettingsIcon }];
    if (isStaff) {
      manage.push({ href: "/admin", label: t("common.labels.admin"), icon: ShieldIcon });
    }
    return {
      study: [
        { href: "/dashboard", label: t("common.labels.dashboard"), icon: HomeIcon },
        { href: "/start", label: t("common.actions.newSession"), icon: PlayCircleIcon },
        { href: "/review", label: t("common.labels.review"), icon: RepeatIcon },
        { href: "/history", label: t("common.labels.history"), icon: ListIcon },
        { href: "/quizzes", label: t("quizBuilder.library.title"), icon: MonitorIcon }
      ],
      manage
    };
  }, [isStaff, t]);
}

function NavList({ items, label, onNavigate }: { items: NavItem[]; label: string; onNavigate?: () => void }) {
  const pathname = usePathname() || "/";
  return (
    <div className="flex flex-col gap-1">
      <p className="px-3 pb-1 text-[0.6875rem] font-semibold tracking-[0.08em] text-fg-subtle uppercase">{label}</p>
      <ul className="flex flex-col gap-0.5">
        {items.map(({ href, label: itemLabel, icon: ItemIcon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                  active ? "bg-surface font-medium text-fg shadow-raised" : "text-fg-muted hover:bg-surface/60 hover:text-fg"
                )}
              >
                <ItemIcon className={active ? "text-primary" : "text-fg-subtle group-hover:text-fg-muted"} />
                {itemLabel}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SessionNotice() {
  const { t } = useI18n();
  const { query } = useSessionRole();
  if (!query.isError) {
    return null;
  }
  return (
    <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
      {readErrorMessage(query.error, t("navigation.errors.sessionRefresh"))}{" "}
      <button type="button" className="focus-ring font-semibold underline underline-offset-2" onClick={() => void query.refetch()}>
        {t("common.actions.retry")}
      </button>
    </p>
  );
}

function AccountBlock() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, query } = useSessionRole();
  const logoutMutation = useLogoutMutation();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  function handleLogout() {
    setLogoutError(null);
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        router.push("/login");
        router.refresh();
      },
      onError: (error) => setLogoutError(readErrorMessage(error, t("navigation.errors.sessionRefresh")))
    });
  }

  if (query.isPending) {
    return (
      <p role="status" className="px-3 text-xs text-fg-subtle">
        {t("common.status.syncingSession")}
      </p>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col gap-2 px-1">
        <div className="px-2">
          <p className="text-sm font-medium text-fg">{t("navigation.account.guest")}</p>
          <p className="text-xs text-fg-muted">{t("navigation.account.guestHint")}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/login" className={cn(buttonClassName("secondary", "sm"), "flex-1")}>
            {t("common.actions.signIn")}
          </Link>
          <Link href="/register" className={cn(buttonClassName("primary", "sm"), "flex-1")}>
            {t("common.actions.createAccount")}
          </Link>
        </div>
      </div>
    );
  }

  const name = user.display_name || user.email;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 px-3">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary uppercase">
          {name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{name}</p>
          <p className="truncate text-xs text-fg-muted capitalize">{user.role}</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={logoutMutation.isPending}
          aria-busy={logoutMutation.isPending || undefined}
          aria-label={t("common.actions.signOut")}
          title={t("common.actions.signOut")}
          className="focus-ring inline-grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface hover:text-fg disabled:opacity-50"
        >
          <LogOutIcon />
        </button>
      </div>
      {logoutError ? (
        <p role="alert" className="px-3 text-xs text-danger">
          {logoutError}
        </p>
      ) : null}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { study, manage } = useNavItems();
  return (
    <div className="flex h-full flex-col gap-6">
      <nav aria-label={t("navigation.ariaLabel")} className="flex flex-col gap-6">
        <NavList items={study} label={t("navigation.sections.study")} onNavigate={onNavigate} />
        <NavList items={manage} label={t("navigation.sections.manage")} onNavigate={onNavigate} />
      </nav>
      <div className="mt-auto flex flex-col gap-4">
        <SessionNotice />
        <InstallAppButton />
        <div className="flex items-center justify-between gap-2 px-1">
          <ThemeSwitch />
          <LocaleSwitch />
        </div>
        <div className="border-t border-line pt-4">
          <AccountBlock />
        </div>
      </div>
    </div>
  );
}

/**
 * Phone / tablet navigation (below lg): a bottom tab bar, like a native app, with the four study
 * destinations within thumb reach and "More" for the full menu (account, admin, theme, language).
 */
function MobileTabBar({ menuOpen, onOpenMenu }: { menuOpen: boolean; onOpenMenu: () => void }) {
  const { t } = useI18n();
  const pathname = usePathname() || "/";
  const tabs: NavItem[] = [
    { href: "/dashboard", label: t("common.labels.dashboard"), icon: HomeIcon },
    { href: "/start", label: t("common.labels.start"), icon: PlayCircleIcon },
    { href: "/review", label: t("common.labels.review"), icon: RepeatIcon },
    { href: "/history", label: t("common.labels.history"), icon: ListIcon }
  ];
  const tabClass = (active: boolean) =>
    cn(
      "focus-ring flex h-full w-full flex-col items-center justify-center gap-1 rounded-md text-[0.6875rem] leading-none transition-colors",
      active ? "font-semibold text-fg" : "font-medium text-fg-muted hover:text-fg"
    );
  const pillClass = (active: boolean) =>
    cn("grid h-7 w-14 place-items-center rounded-full transition-colors", active ? "bg-primary-soft text-primary" : "text-fg-subtle");

  return (
    <nav
      aria-label={t("navigation.tabBar.label")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 px-safe pb-safe backdrop-blur-sm lg:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-xl grid-cols-5 px-1">
        {tabs.map(({ href, label, icon: TabIcon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="min-w-0">
              <Link href={href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
                <span aria-hidden="true" className={pillClass(active)}>
                  <TabIcon size={20} />
                </span>
                <span className="max-w-full truncate px-0.5">{label}</span>
              </Link>
            </li>
          );
        })}
        <li className="min-w-0">
          <button type="button" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onOpenMenu} className={tabClass(menuOpen)}>
            <span aria-hidden="true" className={pillClass(menuOpen)}>
              <MenuIcon size={20} />
            </span>
            <span className="max-w-full truncate px-0.5">{t("navigation.tabBar.more")}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

function AppChrome({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-dvh px-safe lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 overflow-y-auto border-r border-line bg-canvas px-3 py-5 lg:flex">
        <Link href="/dashboard" className="focus-ring self-start rounded-md px-3 py-1">
          <BrandMark />
        </Link>
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 pt-safe backdrop-blur-sm lg:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Link href="/dashboard" className="focus-ring rounded-md">
            <BrandMark />
          </Link>
          <InstallAppButton variant="compact" />
        </div>
      </header>

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} placement="left" title={t("navigation.menu.title")}>
        <SidebarContent onNavigate={() => setMenuOpen(false)} />
      </Dialog>

      {/* Below lg the fixed tab bar covers the last 4rem (+ home indicator): keep content clear of it. */}
      <div id="main-content" tabIndex={-1} className="min-w-0 outline-none max-lg:pb-[calc(4rem+env(safe-area-inset-bottom))]">
        {children}
      </div>

      <MobileTabBar menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} />
    </div>
  );
}

function PublicChrome({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname() || "/";
  const { user, query } = useSessionRole();
  const onLanding = pathname === "/";

  return (
    <div className="flex min-h-dvh flex-col px-safe">
      <header className="border-b border-line pt-safe">
        <div className="mx-auto flex h-16 w-full max-w-page items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-10">
          <Link href="/" className="focus-ring mr-auto rounded-md">
            <BrandMark />
          </Link>
          {onLanding && !user ? (
            <nav aria-label={t("navigation.ariaLabel")} className="hidden items-center gap-1 md:flex">
              <a href="#como-funciona" className="focus-ring rounded-md px-3 py-2 text-sm text-fg-muted hover:text-fg">
                {t("navigation.publicLinks.howItWorks")}
              </a>
              <a href="#faq" className="focus-ring rounded-md px-3 py-2 text-sm text-fg-muted hover:text-fg">
                {t("navigation.publicLinks.faq")}
              </a>
            </nav>
          ) : null}
          <ThemeSwitch className="max-sm:hidden" />
          <LocaleSwitch />
          {query.isPending ? null : user ? (
            <Link href="/dashboard" className={buttonClassName("primary", "sm")}>
              {t("common.labels.dashboard")}
            </Link>
          ) : (
            <>
              {pathname !== "/login" ? (
                <Link href="/login" className={buttonClassName("ghost", "sm")}>
                  {t("common.actions.signIn")}
                </Link>
              ) : null}
              {pathname !== "/register" ? (
                <Link href="/register" className={buttonClassName(onLanding ? "primary" : "secondary", "sm")}>
                  {t("common.actions.createAccount")}
                </Link>
              ) : null}
            </>
          )}
        </div>
      </header>
      <div id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </div>
    </div>
  );
}

/** Chooses the chrome for the current route: app sidebar, public top bar, or none (runner). */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const chrome = resolveChrome(pathname);

  if (chrome === "none") {
    // Live screens (/present, /j, /q) paint edge to edge and pad for the safe areas themselves
    // (LiveThemeRoot); the runner keeps its content clear of notches here.
    return (
      <div id="main-content" tabIndex={-1} className={cn("outline-none", !isLivePath(pathname) && "px-safe")}>
        {children}
      </div>
    );
  }
  if (chrome === "public") {
    return <PublicChrome>{children}</PublicChrome>;
  }
  return <AppChrome>{children}</AppChrome>;
}

export { ThemeSwitch, LocaleSwitch };
