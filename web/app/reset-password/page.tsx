"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { StatusBanner } from "@/components/ui/status-banner";
import { resetPassword } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; title: string; message: string } | null>(null);

  async function handleSubmit() {
    if (!token) {
      setNotice({ tone: "danger", title: "Token ausente", message: "O link de redefinicao esta incompleto." });
      return;
    }
    if (password.trim().length < 8) {
      setNotice({ tone: "warning", title: "Senha invalida", message: "Use pelo menos 8 caracteres." });
      return;
    }
    setIsSubmitting(true);
    setNotice(null);
    try {
      await resetPassword({ token, new_password: password.trim() });
      setNotice({
        tone: "success",
        title: "Senha atualizada",
        message: "Sua senha foi redefinida. Entre novamente com a nova credencial."
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        title: "Falha ao redefinir",
        message: error instanceof Error ? error.message : "Nao foi possivel redefinir a senha."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <Card title="Definir nova senha" subtitle="Use o link recebido por email para concluir a redefinicao.">
          <div className="sq-surface-block">
            {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}
            <Field label="Nova senha" htmlFor="reset-password-field" hint="Minimo de 8 caracteres.">
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
                Atualizar senha
              </Button>
              <Link href="/login" className="sq-button sq-button--md sq-button--ghost">
                Voltar ao login
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
