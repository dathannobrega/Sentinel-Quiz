"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { StatusBanner } from "@/components/ui/status-banner";
import { requestPasswordReset } from "@/lib/auth/session";
import { useI18n } from "@/lib/i18n";

export default function ForgotPasswordPage() {
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
        message: error instanceof Error ? error.message : t("password.forgot.failedMessage")
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <Card title={t("password.forgot.title")} subtitle={t("password.forgot.subtitle")}>
          <div className="sq-surface-block">
            {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}
            <Field label={t("password.forgot.emailLabel")} htmlFor="forgot-email">
              <input
                id="forgot-email"
                className="sq-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <div className="sq-actions">
              <Button busy={isSubmitting} onClick={() => void handleSubmit()}>
                {t("password.forgot.submit")}
              </Button>
              <Link href="/login" className="sq-button sq-button--md sq-button--ghost">
                {t("password.forgot.backToLogin")}
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
