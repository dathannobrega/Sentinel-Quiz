"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError } from "@/lib/api/client";
import { fetchCurrentUser, loginUser, logoutUser, registerUser, requestEmailVerification } from "@/lib/auth/session";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { useI18n } from "@/lib/i18n";
import type { AuthUser } from "@/types/api";

type AuthMode = "login" | "register";
type NoticeTone = "neutral" | "success" | "warning" | "danger";

interface NoticeState {
  tone: NoticeTone;
  title: string;
  message: string;
}

function toNotice(tone: NoticeTone, title: string, message: string): NoticeState {
  return { tone, title, message };
}

function readAuthError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

export function AuthShell({ mode }: { mode: AuthMode }) {
  const { t, getMessage } = useI18n();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<"submit" | "logout" | "resend" | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [loginValues, setLoginValues] = useState({ email: "", password: "" });
  const [registerValues, setRegisterValues] = useState({ displayName: "", email: "", password: "" });
  const stats = getMessage<Array<{ label: string; value: string; meta: string }>>("auth.stats");
  const flowSteps = getMessage<Array<{ title: string; description: string }>>("auth.flow.steps");

  const syncSession = useEffectEvent(async () => {
    setIsLoading(true);
    setNotice(null);
    try {
      setCurrentUser(await fetchCurrentUser());
    } catch (error) {
      setCurrentUser(null);
      setNotice(toNotice("warning", t("auth.notices.sessionUnavailable"), readAuthError(error, t("auth.errors.authUnavailable"))));
    } finally {
      setIsLoading(false);
    }
  });

  useEffect(() => {
    void syncSession();
  }, []);

  async function handleSubmit() {
    const values = mode === "login" ? loginValues : registerValues;
    const email = values.email.trim();
    const password = values.password.trim();

    if (!email || !password) {
      setNotice(
        toNotice("warning", t("common.errors.requiredFields"), t("auth.form.requiredMessage"))
      );
      return;
    }

    if (mode === "register" && password.length < 8) {
      setNotice(
        toNotice("warning", t("common.errors.invalidPassword"), t("auth.form.invalidPasswordMessage"))
      );
      return;
    }

    setPendingAction("submit");
    setNotice(null);

    try {
      const user =
        mode === "login"
          ? await loginUser({ email, password })
          : await registerUser({
              email,
              password,
              display_name: registerValues.displayName.trim() || null
            });

      setCurrentUser(user);
      setNotice(
        toNotice(
          "success",
          mode === "login" ? t("auth.notices.sessionStarted") : t("auth.notices.accountCreated"),
          t("auth.notices.localMerged")
        )
      );
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setNotice(toNotice("danger", t("common.errors.authFailure"), readAuthError(error, t("auth.errors.authUnavailable"))));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleLogout() {
    setPendingAction("logout");
    setNotice(null);
    try {
      await logoutUser();
      setCurrentUser(null);
      setNotice(toNotice("success", t("auth.notices.loggedOut"), t("auth.notices.localMode")));
    } catch (error) {
      setNotice(toNotice("danger", t("auth.notices.logoutFailed"), readAuthError(error, t("auth.errors.authUnavailable"))));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleResendVerification() {
    if (!currentUser) {
      return;
    }
    setPendingAction("resend");
    setNotice(null);
    try {
      await requestEmailVerification({ email: currentUser.email });
      setNotice(
        toNotice(
          "success",
          t("auth.notices.verificationResent"),
          t("auth.notices.verificationResentMessage")
        )
      );
    } catch (error) {
      setNotice(toNotice("danger", t("auth.notices.resendFailed"), readAuthError(error, t("auth.errors.authUnavailable"))));
    } finally {
      setPendingAction(null);
    }
  }

  if (isLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <Skeleton height={180} />
          <div className="sq-grid-2">
            <Skeleton height={420} />
            <Skeleton height={420} />
          </div>
        </div>
      </main>
    );
  }

  const isLogin = mode === "login";

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <section
          className="sq-card sq-hero"
          style={{
            border: "1px solid var(--sq-border)",
            borderRadius: "var(--sq-radius-lg)",
            background: "var(--sq-surface)",
            boxShadow: "var(--sq-shadow-lg)",
            padding: "var(--sq-space-6)"
          }}
        >
          <div className="sq-hero-copy">
            <div className="sq-eyebrow">{isLogin ? t("auth.hero.loginEyebrow") : t("auth.hero.registerEyebrow")}</div>
            <h1 className="sq-hero-title">
              {isLogin ? t("auth.hero.loginTitle") : t("auth.hero.registerTitle")}
            </h1>
            <p className="sq-hero-lead">{t("auth.hero.lead")}</p>
          </div>

          <div className="sq-stat-grid" aria-label={t("auth.hero.benefitsAriaLabel")}>
            {stats.map((item) => (
              <div key={item.label} className="sq-stat">
                <div className="sq-stat-label">{item.label}</div>
                <div className="sq-stat-value">{item.value}</div>
                <div className="sq-stat-meta">{item.meta}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="sq-grid-2">
          <Card
            title={isLogin ? t("auth.form.loginTitle") : t("auth.form.registerTitle")}
            subtitle={
              isLogin
                ? t("auth.form.loginSubtitle")
                : t("auth.form.registerSubtitle")
            }
          >
            <div className="sq-surface-block">
              {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}

              {currentUser ? (
                <div className="sq-surface-block">
                  <div className="sq-list-title">{currentUser.display_name || currentUser.email}</div>
                  <div className="sq-list-meta">
                    {currentUser.email} · {t("auth.account.roleLabel")} {currentUser.role}
                  </div>
                  <div className="sq-chip-row">
                    <span className="sq-chip">
                      {currentUser.email_verified ? t("auth.account.emailVerified") : t("auth.account.emailPending")}
                    </span>
                  </div>

                  <div className="sq-actions" style={{ marginTop: "var(--sq-space-4)" }}>
                    <Link href="/dashboard" className="sq-button sq-button--md sq-button--primary">
                      {t("common.actions.goToDashboard")}
                    </Link>
                    {!currentUser.email_verified ? (
                      <Button variant="ghost" busy={pendingAction === "resend"} onClick={() => void handleResendVerification()}>
                        {t("common.actions.resendVerification")}
                      </Button>
                    ) : null}
                    <Button variant="ghost" busy={pendingAction === "logout"} onClick={() => void handleLogout()}>
                      {t("common.actions.signOut")}
                    </Button>
                  </div>
                </div>
              ) : (
                <form
                  className="sq-surface-block"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSubmit();
                  }}
                  noValidate
                >
                  {!isLogin ? (
                    <Field label={t("auth.form.name")} htmlFor="auth-display-name" hint={t("auth.form.nameHint")}>
                      <input
                        id="auth-display-name"
                        className="sq-input"
                        type="text"
                        autoComplete="name"
                        value={registerValues.displayName}
                        onChange={(event) =>
                          setRegisterValues((current) => ({ ...current, displayName: event.target.value }))
                        }
                      />
                    </Field>
                  ) : null}

                  <Field label={t("auth.form.email")} htmlFor="auth-email">
                    <input
                      id="auth-email"
                      className="sq-input"
                      type="email"
                      autoComplete="email"
                      value={isLogin ? loginValues.email : registerValues.email}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        if (isLogin) {
                          setLoginValues((current) => ({ ...current, email: nextValue }));
                          return;
                        }
                        setRegisterValues((current) => ({ ...current, email: nextValue }));
                      }}
                    />
                  </Field>

                  <Field
                    label={t("auth.form.password")}
                    htmlFor="auth-password"
                    hint={isLogin ? t("auth.form.loginPasswordHint") : t("auth.form.registerPasswordHint")}
                  >
                    <input
                      id="auth-password"
                      className="sq-input"
                      type="password"
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      value={isLogin ? loginValues.password : registerValues.password}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        if (isLogin) {
                          setLoginValues((current) => ({ ...current, password: nextValue }));
                          return;
                        }
                        setRegisterValues((current) => ({ ...current, password: nextValue }));
                      }}
                    />
                  </Field>

                  <div className="sq-actions">
                    <Button type="submit" busy={pendingAction === "submit"}>
                      {isLogin ? t("common.actions.signIn") : t("common.actions.createAccount")}
                    </Button>
                    <Link
                      href={isLogin ? "/register" : "/login"}
                      className="sq-button sq-button--md sq-button--ghost"
                    >
                      {isLogin ? t("auth.form.goToRegister") : t("common.actions.alreadyHaveAccount")}
                    </Link>
                    {isLogin ? (
                      <Link href="/forgot-password" className="sq-button sq-button--md sq-button--ghost">
                        {t("auth.form.forgotPassword")}
                      </Link>
                    ) : null}
                  </div>
                </form>
              )}
            </div>
          </Card>

          <Card
            title={t("auth.flow.title")}
            subtitle={t("auth.flow.subtitle")}
          >
            <div className="sq-list">
              {flowSteps.map((item) => (
                <div key={item.title} className="sq-list-item">
                  <div className="sq-list-title">{item.title}</div>
                  <div className="sq-list-meta">{item.description}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
