"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { StatusBanner } from "@/components/ui/status-banner";
import { requestPasswordReset } from "@/lib/auth/session";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; title: string; message: string } | null>(null);

  async function handleSubmit() {
    if (!email.trim()) {
      setNotice({ tone: "warning", title: "Email obrigatorio", message: "Informe o email da conta para continuar." });
      return;
    }
    setIsSubmitting(true);
    setNotice(null);
    try {
      await requestPasswordReset({ email: email.trim() });
      setNotice({
        tone: "success",
        title: "Solicitacao registrada",
        message: "Se a conta existir, um email com o link de redefinicao foi enviado."
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        title: "Falha ao solicitar",
        message: error instanceof Error ? error.message : "Nao foi possivel iniciar a recuperacao."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <Card title="Recuperar senha" subtitle="Solicite um link seguro para redefinir sua senha.">
          <div className="sq-surface-block">
            {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}
            <Field label="Email" htmlFor="forgot-email">
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
                Enviar link
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
