"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { StatusBanner } from "@/components/ui/status-banner";
import { resetPassword } from "@/lib/auth/session";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    if (password.trim().length < 8) {
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
      await resetPassword({ token, new_password: password.trim() });
      setNotice({
        tone: "success",
        title: t("password.reset.updatedTitle"),
        message: t("password.reset.updatedMessage")
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        title: t("password.reset.failedTitle"),
        message: error instanceof Error ? error.message : t("password.reset.failedMessage")
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <Card title={t("password.reset.title")} subtitle={t("password.reset.subtitle")}>
          <div className="sq-surface-block">
            {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}
            <Field label={t("password.reset.passwordLabel")} htmlFor="reset-password-field" hint={t("password.reset.passwordHint")}>
              <input
                id="reset-password-field"
                className="sq-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <div className="sq-actions">
              <Button busy={isSubmitting} onClick={() => void handleSubmit()}>
                {t("password.reset.submit")}
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
