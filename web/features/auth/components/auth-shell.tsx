"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthLayout, authLinkClassName } from "@/features/auth/components/auth-layout";
import { ApiError, readErrorMessage } from "@/lib/api/client";
import { isEmailNotVerifiedError, requestEmailVerification, sanitizeNextPath } from "@/lib/auth/session";
import { useI18n } from "@/lib/i18n";
import { useCurrentUser, useLoginMutation, useLogoutMutation, useRegisterMutation } from "@/lib/query/hooks";
import { cn } from "@/lib/utils/cn";
import type { RegisterResult } from "@/types/api";

type AuthMode = "login" | "register";
type NoticeTone = "neutral" | "success" | "warning" | "danger";

interface NoticeState {
  tone: NoticeTone;
  title: string;
  message: string;
  /** When set, the banner offers "resend verification" for this e-mail (login 403, r4 §1). */
  resendEmail?: string;
}

function toNotice(tone: NoticeTone, title: string, message: string, resendEmail?: string): NoticeState {
  return resendEmail ? { tone, title, message, resendEmail } : { tone, title, message };
}

function fieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) {
    return undefined;
  }
  return error.fieldErrors.find((item) => item.field === field || item.field.endsWith(`.${field}`))?.message;
}

const noopSubscribe = () => () => {};

export function AuthShell({ mode }: { mode: AuthMode }) {
  const { t, getMessage } = useI18n();
  // This boundary hydrates after the app chrome, which already started the session query: when
  // /api/auth/me answers first, rendering the form during hydration would not match the server's
  // skeleton (React error 418). Keep the skeleton until hydrated, then follow the query.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get("next")) ?? "/dashboard";
  const currentUserQuery = useCurrentUser();
  const loginMutation = useLoginMutation();
  const registerMutation = useRegisterMutation();
  const logoutMutation = useLogoutMutation();
  const [isResending, setIsResending] = useState(false);
  /** E-mail awaiting confirmation after a 202 verification_required registration (r4 §1). */
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [loginValues, setLoginValues] = useState({ email: "", password: "" });
  const [registerValues, setRegisterValues] = useState({ displayName: "", email: "", password: "" });
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
      if (mode === "login" && isEmailNotVerifiedError(error)) {
        // 403 email_not_verified: correct password, account awaiting confirmation (r4 §1).
        setNotice(
          toNotice("warning", t("auth.verification.notVerifiedTitle"), t("auth.verification.notVerifiedMessage"), email)
        );
        return;
      }
      setNotice(toNotice("danger", t("common.errors.authFailure"), readErrorMessage(error, t("auth.errors.authUnavailable"))));
    };

    if (mode === "login") {
      loginMutation.mutate({ email, password }, { onSuccess, onError });
    } else {
      registerMutation.mutate(
        { email, password, display_name: registerValues.displayName.trim() || null },
        {
          onSuccess: (result: RegisterResult) => {
            if (result.kind === "verification_required") {
              // 202: no session yet; the same answer is given for new and existing e-mails.
              setRegisterValues((current) => ({ ...current, password: "" }));
              setPendingVerificationEmail(result.email);
              return;
            }
            onSuccess();
          },
          onError
        }
      );
    }
  }

  async function resendVerification(email: string) {
    setIsResending(true);
    setNotice(null);
    try {
      await requestEmailVerification({ email });
      setNotice(toNotice("success", t("auth.notices.verificationResent"), t("auth.notices.verificationResentMessage")));
    } catch (error) {
      setNotice(toNotice("danger", t("auth.notices.resendFailed"), readErrorMessage(error, t("auth.errors.authUnavailable"))));
    } finally {
      setIsResending(false);
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

  function handleResendVerification() {
    if (currentUser) {
      void resendVerification(currentUser.email);
    }
  }

  if (!hydrated || currentUserQuery.isPending) {
    return (
      <AuthLayout busy title={mode === "login" ? t("auth.form.loginTitle") : t("auth.form.registerTitle")}>
        <div className="flex flex-col gap-4" role="status">
          <span className="sr-only">{t("system.loading")}</span>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={40} className="max-w-32" />
        </div>
      </AuthLayout>
    );
  }

  const isLogin = mode === "login";
  const activeNotice = notice ?? sessionNotice;
  const nextQuery = searchParams.get("next") ? `?next=${encodeURIComponent(nextPath)}` : "";

  return (
    <AuthLayout
      title={isLogin ? t("auth.form.loginTitle") : t("auth.form.registerTitle")}
      description={isLogin ? t("auth.form.loginSubtitle") : t("auth.form.registerSubtitle")}
      footer={
        <Disclosure variant="plain" summary={t("auth.flow.title")} hint={t("auth.flow.subtitle")}>
          <ol className="flex flex-col gap-4">
            {flowSteps.map((item) => (
              <li key={item.title} className="flex flex-col gap-1">
                <p className="text-sm font-medium text-fg">{item.title}</p>
                <p className="text-[0.8125rem] leading-relaxed text-fg-muted">{item.description}</p>
              </li>
            ))}
          </ol>
        </Disclosure>
      }
    >
      {activeNotice ? (
        <Alert
          tone={activeNotice.tone}
          title={activeNotice.title}
          message={activeNotice.message}
          role={activeNotice.tone === "danger" ? "alert" : "status"}
          action={
            activeNotice === sessionNotice ? (
              <Button variant="secondary" size="sm" onClick={() => void currentUserQuery.refetch()}>
                {t("common.actions.retry")}
              </Button>
            ) : activeNotice.resendEmail ? (
              <Button
                variant="secondary"
                size="sm"
                busy={isResending}
                onClick={() => void resendVerification(activeNotice.resendEmail as string)}
              >
                {t("auth.verification.resend")}
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {currentUser ? (
        <section className="flex flex-col gap-5" aria-label={t("navigation.account.label")}>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary uppercase"
            >
              {(currentUser.display_name || currentUser.email).slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-fg">{currentUser.display_name || currentUser.email}</p>
              <p className="truncate text-[0.8125rem] text-fg-muted">
                {currentUser.email} · {t("auth.account.roleLabel")} {currentUser.role}
              </p>
            </div>
            <Badge tone={currentUser.email_verified ? "success" : "warning"}>
              {currentUser.email_verified ? t("auth.account.emailVerified") : t("auth.account.emailPending")}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href={nextPath} className={buttonClassName("primary")}>
              {t("common.actions.goToDashboard")}
            </Link>
            {!currentUser.email_verified ? (
              <Button variant="secondary" busy={isResending} onClick={handleResendVerification}>
                {t("common.actions.resendVerification")}
              </Button>
            ) : null}
            <Button variant="ghost" busy={logoutMutation.isPending} onClick={handleLogout}>
              {t("common.actions.signOut")}
            </Button>
          </div>
        </section>
      ) : !isLogin && pendingVerificationEmail ? (
        <section className="flex flex-col gap-4" aria-labelledby="auth-check-email-title" data-testid="register-check-email">
          <h2 id="auth-check-email-title" className="text-lg font-semibold text-fg">
            {t("auth.verification.checkEmailTitle")}
          </h2>
          <p className="text-[0.9375rem] leading-relaxed text-fg">
            {t("auth.verification.checkEmailMessage", { email: pendingVerificationEmail })}
          </p>
          <p className="text-[0.8125rem] text-fg-muted">{t("auth.verification.checkEmailHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button busy={isResending} onClick={() => void resendVerification(pendingVerificationEmail)}>
              {t("auth.verification.resend")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingVerificationEmail(null);
                setNotice(null);
              }}
            >
              {t("auth.verification.useAnotherEmail")}
            </Button>
          </div>
          <Link href={`/login${nextQuery}`} className={cn(authLinkClassName, "self-start")}>
            {t("common.actions.alreadyHaveAccount")}
          </Link>
        </section>
      ) : (
        <form
          className="flex flex-col gap-5"
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
              hintMode="inline"
              error={fieldError(submitError, "display_name")}
            >
              <Input
                id="auth-display-name"
                type="text"
                autoComplete="name"
                value={registerValues.displayName}
                onChange={(event) => setRegisterValues((current) => ({ ...current, displayName: event.target.value }))}
              />
            </Field>
          ) : null}

          <Field label={t("auth.form.email")} htmlFor="auth-email" error={fieldError(submitError, "email")}>
            <Input
              id="auth-email"
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
            hintMode="inline"
            error={fieldError(submitError, "password")}
          >
            <Input
              id="auth-password"
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

          <Button type="submit" size="lg" busy={isSubmitting} className="w-full">
            {isLogin ? t("common.actions.signIn") : t("common.actions.createAccount")}
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Link href={`${isLogin ? "/register" : "/login"}${nextQuery}`} className={authLinkClassName}>
              {isLogin ? t("auth.form.goToRegister") : t("common.actions.alreadyHaveAccount")}
            </Link>
            {isLogin ? (
              <Link href="/forgot-password" className={authLinkClassName}>
                {t("auth.form.forgotPassword")}
              </Link>
            ) : null}
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
