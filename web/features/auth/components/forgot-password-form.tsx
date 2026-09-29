"use client";

import { useState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthLayout, authLinkClassName } from "@/features/auth/components/auth-layout";
import { readErrorMessage } from "@/lib/api/client";
import { requestPasswordReset } from "@/lib/auth/session";
import { useI18n } from "@/lib/i18n";

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; title: string; message: string } | null>(null);

  async function handleSubmit() {
    if (!email.trim()) {
      setNotice({
        tone: "warning",
        title: t("password.forgot.emailRequiredTitle"),
        message: t("password.forgot.emailRequiredMessage")
      });
      return;
    }
    setIsSubmitting(true);
    setNotice(null);
    try {
      await requestPasswordReset({ email: email.trim() });
      setNotice({
        tone: "success",
        title: t("password.forgot.requestedTitle"),
        message: t("password.forgot.requestedMessage")
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        title: t("password.forgot.failedTitle"),
        message: readErrorMessage(error, t("password.forgot.failedMessage"))
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout title={t("password.forgot.title")} description={t("password.forgot.subtitle")}>
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
        <Field label={t("password.forgot.emailLabel")} htmlFor="forgot-email">
          <Input id="forgot-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Button type="submit" size="lg" busy={isSubmitting} className="w-full">
          {t("password.forgot.submit")}
        </Button>
        <Link href="/login" className={`${authLinkClassName} self-start`}>
          {t("password.forgot.backToLogin")}
        </Link>
      </form>
    </AuthLayout>
  );
}
