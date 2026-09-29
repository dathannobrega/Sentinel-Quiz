"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

import { Button, buttonClassName } from "@/components/ui/button";
import { StatePage } from "@/components/ui/state-page";
import { useI18n } from "@/lib/i18n";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error(error);
    headingRef.current?.focus();
  }, [error]);

  return (
    <StatePage
      role="alert"
      titleRef={headingRef}
      title={t("system.errorBoundary.title")}
      message={t("system.errorBoundary.message")}
      detail={error.digest ? t("system.errorBoundary.reference", { digest: error.digest }) : undefined}
      actions={
        <>
          <Button onClick={() => reset()}>{t("system.errorBoundary.retry")}</Button>
          <Link href="/" className={buttonClassName("secondary")}>
            {t("system.errorBoundary.home")}
          </Link>
        </>
      }
    />
  );
}
