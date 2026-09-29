"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { readErrorMessage } from "@/lib/api/client";
import { sanitizeNextPath } from "@/lib/auth/session";
import { useI18n } from "@/lib/i18n";
import { useVerifyEmailMutation } from "@/lib/query/hooks";

type Notice = { tone: "success" | "danger"; title: string; message: string };

export function VerifyEmailPanel() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const nextPath = sanitizeNextPath(searchParams.get("next")) ?? "/dashboard";
  const { mutate: verifyEmail } = useVerifyEmailMutation();
  const [isLoading, setIsLoading] = useState(Boolean(token));
  const [isRedirecting, setIsRedirecting] = useState(false);
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
    verifyEmail(token, {
      onSuccess: ({ user, signedIn }) => {
        setNotice({
          tone: "success",
          title: t("password.verify.successTitle"),
          message: t("password.verify.successMessage", { email: user.email })
        });
        if (signedIn) {
          // r4 §1: verification opens the session; the mutation already cached the user.
          setIsRedirecting(true);
          router.replace(nextPath);
        }
      },
      onError: (error: unknown) => {
        setNotice({
          tone: "danger",
          title: t("password.verify.failedTitle"),
          message: readErrorMessage(error, t("password.verify.failedMessage"))
        });
      },
      onSettled: () => setIsLoading(false)
    });
  }, [nextPath, router, t, token, verifyEmail]);

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
                message={isRedirecting ? `${notice.message} ${t("password.verify.redirecting")}` : notice.message}
                role={notice.tone === "danger" ? "alert" : "status"}
              />
            ) : null}
            <div className="sq-actions">
              {isRedirecting ? (
                <Link href={nextPath} className="sq-button sq-button--md sq-button--primary">
                  {t("common.labels.dashboard")}
                </Link>
              ) : (
                <>
                  <Link href="/login" className="sq-button sq-button--md sq-button--primary">
                    {t("password.verify.goToLogin")}
                  </Link>
                  <Link href="/dashboard" className="sq-button sq-button--md sq-button--ghost">
                    {t("common.labels.dashboard")}
                  </Link>
                </>
              )}
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
