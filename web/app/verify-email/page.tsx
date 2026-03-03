"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { verifyEmailToken } from "@/lib/auth/session";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";

export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; title: string; message: string } | null>(null);

  const verify = useEffectEvent(async () => {
    if (!token) {
      setNotice({
        tone: "danger",
        title: "Token ausente",
        message: "O link de verificacao esta incompleto."
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
        title: "Email verificado",
        message: `O email ${user.email} foi validado com sucesso.`
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        title: "Falha na verificacao",
        message: error instanceof Error ? error.message : "Nao foi possivel validar o email."
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
        <Card title="Verificacao de email" subtitle="Confirmação de identidade para fortalecer a conta.">
          <div className="sq-surface-block">
            {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}
            <div className="sq-actions">
              <Link href="/login" className="sq-button sq-button--md sq-button--primary">
                Ir para login
              </Link>
              <Link href="/dashboard" className="sq-button sq-button--md sq-button--ghost">
                Dashboard
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
