"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { verifyEmailToken } from "@/lib/auth/session";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { useI18n } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; title: string; message: string } | null>(null);

  const verify = useEffectEvent(async () => {
    if (!token) {
      setNotice({
        tone: "danger",
        title: t("common.errors.missingToken"),
        message: t("password.verify.missingTokenMessage")
      });
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setNotice(null);
    try {
      const user = await verifyEmailToken({ token });
      setNotice({
        tone: "success",
        title: t("password.verify.successTitle"),
        message: t("password.verify.successMessage", { email: user.email })
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        title: t("password.verify.failedTitle"),
        message: error instanceof Error ? error.message : t("password.verify.failedMessage")
      });
    } finally {
      setIsLoading(false);
    }
  });

  useEffect(() => {
    void verify();
  }, [verify]);

  if (isLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
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
            {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}
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
