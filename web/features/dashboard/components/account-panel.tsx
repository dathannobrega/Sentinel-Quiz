import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { formatDateTime, formatScope } from "@/lib/utils/format";
import type { AuthUser, StudyOverview } from "@/types/api";

import type { DashboardNotice } from "@/features/dashboard/types";

interface AccountPanelProps {
  user: AuthUser | null;
  overview: StudyOverview;
  notice: DashboardNotice | null;
  pendingAction: "logout" | null;
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
  notice,
  pendingAction,
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
            <div className="sq-list">
              <div className="sq-list-item">
                <div className="sq-list-title">Modo local ativo</div>
                <div className="sq-list-meta">
                  Voce ainda pode usar o dispositivo atual, mas o progresso nao esta sincronizado entre navegadores.
                </div>
              </div>
              <div className="sq-list-item">
                <div className="sq-list-title">Autentique para consolidar o historico</div>
                <div className="sq-list-meta">
                  Ao entrar, o backend associa sessoes, bookmarks, notas e revisoes deste dispositivo a sua conta.
                </div>
              </div>
            </div>

            <div className="sq-actions">
              <Link href="/login" className="sq-button sq-button--md sq-button--primary">
                Entrar
              </Link>
              <Link href="/register" className="sq-button sq-button--md sq-button--ghost">
                Criar conta
              </Link>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
