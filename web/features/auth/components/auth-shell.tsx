"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError, readErrorMessage } from "@/lib/api/client";
import { requestEmailVerification, sanitizeNextPath } from "@/lib/auth/session";
import { useI18n } from "@/lib/i18n";
import { useCurrentUser, useLoginMutation, useLogoutMutation, useRegisterMutation } from "@/lib/query/hooks";

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

function fieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) {
    return undefined;
  }
  return error.fieldErrors.find((item) => item.field === field || item.field.endsWith(`.${field}`))?.message;
}

export function AuthShell({ mode }: { mode: AuthMode }) {
  const { t, getMessage } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get("next")) ?? "/dashboard";
  const currentUserQuery = useCurrentUser();
  const loginMutation = useLoginMutation();
  const registerMutation = useRegisterMutation();
  const logoutMutation = useLogoutMutation();
  const [isResending, setIsResending] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [loginValues, setLoginValues] = useState({ email: "", password: "" });
  const [registerValues, setRegisterValues] = useState({ displayName: "", email: "", password: "" });
  const stats = getMessage<Array<{ label: string; value: string; meta: string }>>("auth.stats");
  const flowSteps = getMessage<Array<{ title: string; description: string }>>("auth.flow.steps");

  const currentUser = currentUserQuery.data ?? null;
  const isSubmitting = loginMutation.isPending || registerMutation.isPending;
  const sessionNotice =
    currentUserQuery.isError && !notice
      ? toNotice(
          "warning",
          t("auth.notices.sessionUnavailable"),
          readErrorMessage(currentUserQuery.error, t("auth.errors.authUnavailable"))
        )
      : null;

  function handleSubmit() {
    const values = mode === "login" ? loginValues : registerValues;
    const email = values.email.trim();
    // Passwords are sent exactly as typed (spaces are significant).
    const password = values.password;

    if (!email || !password) {
      setNotice(toNotice("warning", t("common.errors.requiredFields"), t("auth.form.requiredMessage")));
      return;
    }

    if (mode === "register" && password.length < 8) {
      setNotice(toNotice("warning", t("common.errors.invalidPassword"), t("auth.form.invalidPasswordMessage")));
      return;
    }

    setNotice(null);
    setSubmitError(null);

    const onSuccess = () => {
      setNotice(
        toNotice(
          "success",
          mode === "login" ? t("auth.notices.sessionStarted") : t("auth.notices.accountCreated"),
          t("auth.notices.localMerged")
        )
      );
      router.push(nextPath);
      router.refresh();
    };
    const onError = (error: unknown) => {
      setSubmitError(error);
      setNotice(toNotice("danger", t("common.errors.authFailure"), readErrorMessage(error, t("auth.errors.authUnavailable"))));
    };

    if (mode === "login") {
      loginMutation.mutate({ email, password }, { onSuccess, onError });
    } else {
      registerMutation.mutate(
        { email, password, display_name: registerValues.displayName.trim() || null },
        { onSuccess, onError }
      );
    }
  }

  function handleLogout() {
    setNotice(null);
    logoutMutation.mutate(undefined, {
      onSuccess: () => setNotice(toNotice("success", t("auth.notices.loggedOut"), t("auth.notices.localMode"))),
      onError: (error) =>
        setNotice(toNotice("danger", t("auth.notices.logoutFailed"), readErrorMessage(error, t("auth.errors.authUnavailable"))))
    });
  }

  async function handleResendVerification() {
    if (!currentUser) {
      return;
    }
    setIsResending(true);
    setNotice(null);
    try {
      await requestEmailVerification({ email: currentUser.email });
      setNotice(toNotice("success", t("auth.notices.verificationResent"), t("auth.notices.verificationResentMessage")));
    } catch (error) {
      setNotice(toNotice("danger", t("auth.notices.resendFailed"), readErrorMessage(error, t("auth.errors.authUnavailable"))));
    } finally {
      setIsResending(false);
    }
  }

  if (currentUserQuery.isPending) {
    return (
      <main className="sq-app-shell" aria-busy="true">
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
  const activeNotice = notice ?? sessionNotice;

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
            <h1 className="sq-hero-title">{isLogin ? t("auth.hero.loginTitle") : t("auth.hero.registerTitle")}</h1>
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
            subtitle={isLogin ? t("auth.form.loginSubtitle") : t("auth.form.registerSubtitle")}
          >
            <div className="sq-surface-block">
              {activeNotice ? (
                <StatusBanner
                  tone={activeNotice.tone}
                  title={activeNotice.title}
                  message={activeNotice.message}
                  role={activeNotice.tone === "danger" ? "alert" : "status"}
                  action={
                    activeNotice === sessionNotice ? (
                      <Button variant="ghost" size="sm" onClick={() => void currentUserQuery.refetch()}>
                        {t("common.actions.retry")}
                      </Button>
                    ) : undefined
                  }
                />
              ) : null}

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
                    <Link href={nextPath} className="sq-button sq-button--md sq-button--primary">
                      {t("common.actions.goToDashboard")}
                    </Link>
                    {!currentUser.email_verified ? (
                      <Button variant="ghost" busy={isResending} onClick={() => void handleResendVerification()}>
                        {t("common.actions.resendVerification")}
                      </Button>
                    ) : null}
                    <Button variant="ghost" busy={logoutMutation.isPending} onClick={handleLogout}>
                      {t("common.actions.signOut")}
                    </Button>
                  </div>
                </div>
              ) : (
                <form
                  className="sq-surface-block"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSubmit();
                  }}
                  noValidate
                >
                  {!isLogin ? (
                    <Field
                      label={t("auth.form.name")}
                      htmlFor="auth-display-name"
                      hint={t("auth.form.nameHint")}
                      error={fieldError(submitError, "display_name")}
                    >
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

                  <Field label={t("auth.form.email")} htmlFor="auth-email" error={fieldError(submitError, "email")}>
                    <input
                      id="auth-email"
                      className="sq-input"
                      type="email"
                      autoComplete="email"
                      required
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
                    error={fieldError(submitError, "password")}
                  >
                    <input
                      id="auth-password"
                      className="sq-input"
                      type="password"
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      required
                      minLength={isLogin ? undefined : 8}
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
                    <Button type="submit" busy={isSubmitting}>
                      {isLogin ? t("common.actions.signIn") : t("common.actions.createAccount")}
                    </Button>
                    <Link
                      href={`${isLogin ? "/register" : "/login"}${searchParams.get("next") ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
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

          <Card title={t("auth.flow.title")} subtitle={t("auth.flow.subtitle")}>
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
