"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.error(error);
    headingRef.current?.focus();
  }, [error]);

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack sq-state-page">
        <Card className="sq-state-page__card" title={t("system.errorBoundary.title")}>
          <div ref={headingRef} tabIndex={-1} role="alert" className="sq-surface-block">
            <p className="sq-list-meta">{t("system.errorBoundary.message")}</p>
            {error.digest ? (
              <p className="sq-list-meta">{t("system.errorBoundary.reference", { digest: error.digest })}</p>
            ) : null}
            <div className="sq-actions">
              <Button onClick={() => reset()}>{t("system.errorBoundary.retry")}</Button>
              <Link href="/" className="sq-button sq-button--md sq-button--ghost">
                {t("system.errorBoundary.home")}
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
