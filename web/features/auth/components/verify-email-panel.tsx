"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { readErrorMessage } from "@/lib/api/client";
import { verifyEmailToken } from "@/lib/auth/session";
import { useI18n } from "@/lib/i18n";
import { useSetCurrentUser } from "@/lib/query/hooks";

type Notice = { tone: "success" | "danger"; title: string; message: string };

export function VerifyEmailPanel() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const setCurrentUser = useSetCurrentUser();
  const [isLoading, setIsLoading] = useState(Boolean(token));
  const [notice, setNotice] = useState<Notice | null>(
    token
      ? null
      : {
          tone: "danger",
          title: t("common.errors.missingToken"),
          message: t("password.verify.missingTokenMessage")
        }
  );
  // Verification tokens are single-use: StrictMode double effects must not consume it twice.
  const consumedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token || consumedTokenRef.current === token) {
      return;
    }
    consumedTokenRef.current = token;
    setIsLoading(true);
    verifyEmailToken({ token })
      .then((user) => {
        setCurrentUser(user);
        setNotice({
          tone: "success",
          title: t("password.verify.successTitle"),
          message: t("password.verify.successMessage", { email: user.email })
        });
      })
      .catch((error: unknown) => {
        setNotice({
          tone: "danger",
          title: t("password.verify.failedTitle"),
          message: readErrorMessage(error, t("password.verify.failedMessage"))
        });
      })
      .finally(() => setIsLoading(false));
  }, [setCurrentUser, t, token]);

  if (isLoading) {
    return (
      <main className="sq-app-shell" aria-busy="true">
        <div className="sq-page-stack" role="status">
          <span className="sq-visually-hidden">{t("system.loading")}</span>
          <Skeleton height={220} />
        </div>
      </main>
    );
  }

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <Card title={t("password.verify.title")} subtitle={t("password.verify.subtitle")}>
          <div className="sq-surface-block">
            {notice ? (
              <StatusBanner
                tone={notice.tone}
                title={notice.title}
                message={notice.message}
                role={notice.tone === "danger" ? "alert" : "status"}
              />
            ) : null}
            <div className="sq-actions">
              <Link href="/login" className="sq-button sq-button--md sq-button--primary">
                {t("password.verify.goToLogin")}
              </Link>
              <Link href="/dashboard" className="sq-button sq-button--md sq-button--ghost">
                {t("common.labels.dashboard")}
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
