"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError } from "@/lib/api/client";
import { fetchCurrentUser, loginUser, logoutUser, registerUser } from "@/lib/auth/session";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import type { AuthUser } from "@/types/api";

type AuthMode = "login" | "register";
type NoticeTone = "neutral" | "success" | "warning" | "danger";

interface NoticeState {
  tone: NoticeTone;
  title: string;
  message: string;
}

function toNotice(tone: NoticeTone, title: string, message: string): NoticeState {
  return { tone, title, message };
}

function readAuthError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Nao foi possivel concluir a autenticacao.";
}

export function AuthShell({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<"submit" | "logout" | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [loginValues, setLoginValues] = useState({ email: "", password: "" });
  const [registerValues, setRegisterValues] = useState({ displayName: "", email: "", password: "" });

  const syncSession = useEffectEvent(async () => {
    setIsLoading(true);
    setNotice(null);
    try {
      setCurrentUser(await fetchCurrentUser());
    } catch (error) {
      setCurrentUser(null);
      setNotice(toNotice("warning", "Sessao indisponivel", readAuthError(error)));
    } finally {
      setIsLoading(false);
    }
  });

  useEffect(() => {
    void syncSession();
  }, []);

  async function handleSubmit() {
    const values = mode === "login" ? loginValues : registerValues;
    const email = values.email.trim();
    const password = values.password.trim();

    if (!email || !password) {
      setNotice(toNotice("warning", "Campos obrigatorios", "Preencha email e senha antes de continuar."));
      return;
    }

    if (mode === "register" && password.length < 8) {
      setNotice(toNotice("warning", "Senha invalida", "Use pelo menos 8 caracteres para criar a conta."));
      return;
    }

    setPendingAction("submit");
    setNotice(null);

    try {
      const user =
        mode === "login"
          ? await loginUser({ email, password })
          : await registerUser({
              email,
              password,
              display_name: registerValues.displayName.trim() || null
            });

      setCurrentUser(user);
      setNotice(
        toNotice(
          "success",
          mode === "login" ? "Sessao iniciada" : "Conta criada",
          "O progresso local deste dispositivo foi associado a sua conta quando aplicavel."
        )
      );
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setNotice(toNotice("danger", "Falha de autenticacao", readAuthError(error)));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleLogout() {
    setPendingAction("logout");
    setNotice(null);
    try {
      await logoutUser();
      setCurrentUser(null);
      setNotice(toNotice("success", "Sessao encerrada", "Voce voltou ao modo local deste dispositivo."));
    } catch (error) {
      setNotice(toNotice("danger", "Falha ao sair", readAuthError(error)));
    } finally {
      setPendingAction(null);
    }
  }

  if (isLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <Skeleton height={180} />
          <div className="sq-grid-2">
            <Skeleton height={420} />
            <Skeleton height={420} />
          </div>
        </div>
      </main>
    );
  }

  const isLogin = mode === "login";

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <section
          className="sq-card sq-hero"
          style={{
            border: "1px solid var(--sq-border)",
            borderRadius: "var(--sq-radius-lg)",
            background: "var(--sq-surface)",
            boxShadow: "var(--sq-shadow-lg)",
            padding: "var(--sq-space-6)"
          }}
        >
          <div className="sq-hero-copy">
            <div className="sq-eyebrow">{isLogin ? "Sessao segura" : "Criacao de conta"}</div>
            <h1 className="sq-hero-title">
              {isLogin ? "Entre para sincronizar seu progresso." : "Crie sua conta e continue de qualquer dispositivo."}
            </h1>
            <p className="sq-hero-lead">
              A autenticacao usa cookie HttpOnly no backend. Quando voce entra, o sistema associa historico local,
              bookmarks, notas e revisoes pendentes a sua conta sem expor a sessao em `localStorage`.
            </p>
          </div>

          <div className="sq-stat-grid" aria-label="Beneficios da conta">
            <div className="sq-stat">
              <div className="sq-stat-label">Sincronizacao</div>
              <div className="sq-stat-value">Conta</div>
              <div className="sq-stat-meta">Historico, revisao e progresso unificados.</div>
            </div>
            <div className="sq-stat">
              <div className="sq-stat-label">Seguranca</div>
              <div className="sq-stat-value">HttpOnly</div>
              <div className="sq-stat-meta">Sessao protegida via cookie e backend tipado.</div>
            </div>
            <div className="sq-stat">
              <div className="sq-stat-label">Continuidade</div>
              <div className="sq-stat-value">Auto-merge</div>
              <div className="sq-stat-meta">O dispositivo atual e consolidado quando aplicavel.</div>
            </div>
            <div className="sq-stat">
              <div className="sq-stat-label">Acesso</div>
              <div className="sq-stat-value">Web</div>
              <div className="sq-stat-meta">Pronto para estudo, simulados e revisao guiada.</div>
            </div>
          </div>
        </section>

        <div className="sq-grid-2">
          <Card
            title={isLogin ? "Entrar" : "Criar conta"}
            subtitle={
              isLogin
                ? "Use a mesma conta para retomar estudos e simulados em qualquer navegador."
                : "Crie uma conta para salvar seu progresso e destravar os fluxos protegidos."
            }
          >
            <div className="sq-surface-block">
              {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}

              {currentUser ? (
                <div className="sq-surface-block">
                  <div className="sq-list-title">{currentUser.display_name || currentUser.email}</div>
                  <div className="sq-list-meta">
                    {currentUser.email} · papel {currentUser.role}
                  </div>

                  <div className="sq-actions" style={{ marginTop: "var(--sq-space-4)" }}>
                    <Link href="/dashboard" className="sq-button sq-button--md sq-button--primary">
                      Ir para o dashboard
                    </Link>
                    <Button variant="ghost" busy={pendingAction === "logout"} onClick={() => void handleLogout()}>
                      Sair
                    </Button>
                  </div>
                </div>
              ) : (
                <form
                  className="sq-surface-block"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSubmit();
                  }}
                  noValidate
                >
                  {!isLogin ? (
                    <Field label="Nome" htmlFor="auth-display-name" hint="Opcional. Facilita identificar a conta.">
                      <input
                        id="auth-display-name"
                        className="sq-input"
                        type="text"
                        autoComplete="name"
                        value={registerValues.displayName}
                        onChange={(event) =>
                          setRegisterValues((current) => ({ ...current, displayName: event.target.value }))
                        }
                      />
                    </Field>
                  ) : null}

                  <Field label="Email" htmlFor="auth-email">
                    <input
                      id="auth-email"
                      className="sq-input"
                      type="email"
                      autoComplete="email"
                      value={isLogin ? loginValues.email : registerValues.email}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        if (isLogin) {
                          setLoginValues((current) => ({ ...current, email: nextValue }));
                          return;
                        }
                        setRegisterValues((current) => ({ ...current, email: nextValue }));
                      }}
                    />
                  </Field>

                  <Field
                    label="Senha"
                    htmlFor="auth-password"
                    hint={isLogin ? "Use a senha da conta existente." : "Minimo de 8 caracteres."}
                  >
                    <input
                      id="auth-password"
                      className="sq-input"
                      type="password"
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      value={isLogin ? loginValues.password : registerValues.password}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        if (isLogin) {
                          setLoginValues((current) => ({ ...current, password: nextValue }));
                          return;
                        }
                        setRegisterValues((current) => ({ ...current, password: nextValue }));
                      }}
                    />
                  </Field>

                  <div className="sq-actions">
                    <Button type="submit" busy={pendingAction === "submit"}>
                      {isLogin ? "Entrar" : "Criar conta"}
                    </Button>
                    <Link
                      href={isLogin ? "/register" : "/login"}
                      className="sq-button sq-button--md sq-button--ghost"
                    >
                      {isLogin ? "Ir para cadastro" : "Ja tenho conta"}
                    </Link>
                  </div>
                </form>
              )}
            </div>
          </Card>

          <Card
            title="O que acontece ao autenticar"
            subtitle="Fluxo pensado para preservar dados e evitar retrabalho."
          >
            <div className="sq-list">
              <div className="sq-list-item">
                <div className="sq-list-title">1. Sessao protegida no backend</div>
                <div className="sq-list-meta">
                  O login estabelece a sessao principal por cookie HttpOnly e mantem o token em memoria apenas como
                  compatibilidade transitória.
                </div>
              </div>
              <div className="sq-list-item">
                <div className="sq-list-title">2. Merge do progresso local</div>
                <div className="sq-list-meta">
                  Sessoes, bookmarks, notas e itens da fila de revisao do dispositivo atual podem ser associados a sua
                  conta automaticamente.
                </div>
              </div>
              <div className="sq-list-item">
                <div className="sq-list-title">3. Continuidade entre dispositivos</div>
                <div className="sq-list-meta">
                  Depois do login, o dashboard, o historico e os modos de estudo passam a refletir o escopo da conta.
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
