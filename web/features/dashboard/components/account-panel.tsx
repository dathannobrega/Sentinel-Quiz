import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { StatusBanner } from "@/components/ui/status-banner";
import { formatDateTime, formatScope } from "@/lib/utils/format";
import type { AuthUser, StudyOverview } from "@/types/api";

import type {
  DashboardNotice,
  LoginFormValues,
  RegisterFormValues
} from "@/features/dashboard/types";

interface AccountPanelProps {
  user: AuthUser | null;
  overview: StudyOverview;
  loginValues: LoginFormValues;
  registerValues: RegisterFormValues;
  notice: DashboardNotice | null;
  pendingAction: "login" | "register" | "logout" | null;
  onLoginChange: (field: keyof LoginFormValues, value: string) => void;
  onRegisterChange: (field: keyof RegisterFormValues, value: string) => void;
  onLoginSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRegisterSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLogout: () => void;
}

function StudyList({
  title,
  items,
  emptyCopy
}: {
  title: string;
  items: StudyOverview["recent_bookmarks"];
  emptyCopy: string;
}) {
  return (
    <div className="sq-surface-block">
      <div className="sq-list-title">{title}</div>
      {items.length ? (
        <div className="sq-list">
          {items.slice(0, 3).map((item) => (
            <div key={`${title}-${item.question_id}`} className="sq-list-item">
              <div className="sq-list-title">{item.prompt}</div>
              <div className="sq-list-meta">
                {item.excerpt ? `${item.excerpt} · ` : ""}
                Atualizado em {formatDateTime(item.updated_at)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sq-empty">{emptyCopy}</div>
      )}
    </div>
  );
}

export function AccountPanel({
  user,
  overview,
  loginValues,
  registerValues,
  notice,
  pendingAction,
  onLoginChange,
  onRegisterChange,
  onLoginSubmit,
  onRegisterSubmit,
  onLogout
}: AccountPanelProps) {
  return (
    <Card
      title="Conta e sincronizacao"
      subtitle="Sincronize progresso entre dispositivos sem perder o fallback local."
      actions={
        <span className="sq-chip" aria-live="polite">
          {formatScope(overview.scope)}
        </span>
      }
    >
      <div className="sq-surface-block">
        {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}

        {user ? (
          <div className="sq-surface-block">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--sq-space-4)",
                flexWrap: "wrap"
              }}
            >
              <div>
                <div className="sq-list-title">{user.display_name || user.email}</div>
                <div className="sq-list-meta">
                  {user.email} · papel {user.role} · desde {formatDateTime(user.created_at)}
                </div>
              </div>
              <Button variant="ghost" size="sm" busy={pendingAction === "logout"} onClick={onLogout}>
                Sair
              </Button>
            </div>

            <div className="sq-metric-grid" aria-label="Resumo da conta">
              <div className="sq-metric-card">
                <span className="sq-muted">Bookmarks</span>
                <strong>{overview.bookmark_count}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Notas</span>
                <strong>{overview.note_count}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Revisoes vencidas</span>
                <strong>{overview.due_review_count}</strong>
              </div>
            </div>

            <StudyList
              title="Bookmarks recentes"
              items={overview.recent_bookmarks}
              emptyCopy="Nenhum bookmark salvo ainda."
            />
            <StudyList title="Notas recentes" items={overview.recent_notes} emptyCopy="Nenhuma nota salva ainda." />
            <StudyList
              title="Fila de revisao"
              items={overview.due_reviews}
              emptyCopy="Nenhuma revisao vencida no momento."
            />
          </div>
        ) : (
          <div className="sq-surface-block">
            <div className="sq-form-grid">
              <form className="sq-surface-block" onSubmit={onLoginSubmit} noValidate>
                <Field label="Email" htmlFor="login-email">
                  <input
                    id="login-email"
                    className="sq-input"
                    type="email"
                    autoComplete="email"
                    value={loginValues.email}
                    onChange={(event) => onLoginChange("email", event.target.value)}
                  />
                </Field>
                <Field label="Senha" htmlFor="login-password">
                  <input
                    id="login-password"
                    className="sq-input"
                    type="password"
                    autoComplete="current-password"
                    value={loginValues.password}
                    onChange={(event) => onLoginChange("password", event.target.value)}
                  />
                </Field>
                <Button type="submit" busy={pendingAction === "login"}>
                  Entrar
                </Button>
              </form>

              <form className="sq-surface-block" onSubmit={onRegisterSubmit} noValidate>
                <Field label="Nome" htmlFor="register-name" hint="Opcional. Ajuda a identificar a conta.">
                  <input
                    id="register-name"
                    className="sq-input"
                    type="text"
                    autoComplete="name"
                    value={registerValues.displayName}
                    onChange={(event) => onRegisterChange("displayName", event.target.value)}
                  />
                </Field>
                <Field label="Email" htmlFor="register-email">
                  <input
                    id="register-email"
                    className="sq-input"
                    type="email"
                    autoComplete="email"
                    value={registerValues.email}
                    onChange={(event) => onRegisterChange("email", event.target.value)}
                  />
                </Field>
                <Field
                  label="Senha"
                  htmlFor="register-password"
                  hint="Use pelo menos 8 caracteres para manter o login valido."
                >
                  <input
                    id="register-password"
                    className="sq-input"
                    type="password"
                    autoComplete="new-password"
                    value={registerValues.password}
                    onChange={(event) => onRegisterChange("password", event.target.value)}
                  />
                </Field>
                <Button type="submit" variant="secondary" busy={pendingAction === "register"}>
                  Criar conta
                </Button>
              </form>
            </div>

            <div className="sq-empty">
              O progresso continua no dispositivo atual mesmo sem conta. Ao entrar depois, o backend mescla sessoes e
              estado de estudo automaticamente.
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
