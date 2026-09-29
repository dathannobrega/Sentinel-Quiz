"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthLayout, authLinkClassName } from "@/features/auth/components/auth-layout";
import { readErrorMessage } from "@/lib/api/client";
import { resetPassword } from "@/lib/auth/session";
import { useI18n } from "@/lib/i18n";

export function ResetPasswordForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; title: string; message: string } | null>(null);

  async function handleSubmit() {
    if (!token) {
      setNotice({
        tone: "danger",
        title: t("common.errors.missingToken"),
        message: t("password.reset.missingTokenMessage")
      });
      return;
    }
    // Passwords are sent verbatim: leading/trailing spaces are part of the secret.
    if (password.length < 8) {
      setNotice({
        tone: "warning",
        title: t("common.errors.invalidPassword"),
        message: t("password.reset.invalidPasswordMessage")
      });
      return;
    }
    setIsSubmitting(true);
    setNotice(null);
    try {
      await resetPassword({ token, new_password: password });
      setPassword("");
      setIsDone(true);
      setNotice({
        tone: "success",
        title: t("password.reset.updatedTitle"),
        message: t("password.reset.updatedMessage")
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        title: t("password.reset.failedTitle"),
        message: readErrorMessage(error, t("password.reset.failedMessage"))
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout title={t("password.reset.title")} description={t("password.reset.subtitle")}>
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        {notice ? (
          <Alert tone={notice.tone} title={notice.title} message={notice.message} role={notice.tone === "danger" ? "alert" : "status"} />
        ) : null}
        <Field label={t("password.reset.passwordLabel")} htmlFor="reset-password-field" hint={t("password.reset.passwordHint")} hintMode="inline">
          <Input
            id="reset-password-field"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            disabled={isDone}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button type="submit" size="lg" busy={isSubmitting} disabled={isDone} className="w-full">
          {t("password.reset.submit")}
        </Button>
        <Link href="/login" className={`${authLinkClassName} self-start`}>
          {t("password.forgot.backToLogin")}
        </Link>
      </form>
    </AuthLayout>
  );
}
