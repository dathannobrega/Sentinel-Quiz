import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, formatDateTime, formatScore } from "@/lib/utils/format";
import type { SessionHistoryItem, StudyHistoryItem, StudyOverview, WeakAreaTrack } from "@/types/api";

interface InsightsPanelProps {
  weakAreas: WeakAreaTrack[];
  studyOverview: StudyOverview;
  examHistory: SessionHistoryItem[];
  studyHistory: StudyHistoryItem[];
  refreshing: boolean;
  onRefresh: () => void;
}

function SessionSummary({ history }: { history: SessionHistoryItem[] }) {
  if (!history.length) {
    return <div className="sq-empty">Nenhum simulado concluido ainda. Crie um primeiro bloco para popular esse painel.</div>;
  }

  return (
    <div className="sq-list">
      {history.slice(0, 4).map((item) => (
        <div key={item.id} className="sq-list-item">
          <div className="sq-list-title">{item.exam_title || item.exam_id || "Simulado misto"}</div>
          <div className="sq-list-meta">
            {formatScore(item.score_percent)} · {item.correct_count}/{item.total_questions} corretas ·{" "}
            {formatDateTime(item.completed_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

function StudySummary({ history }: { history: StudyHistoryItem[] }) {
  if (!history.length) {
    return <div className="sq-empty">Nenhum bloco de estudo concluido ainda.</div>;
  }

  return (
    <div className="sq-list">
      {history.slice(0, 4).map((item) => (
        <div key={item.id} className="sq-list-item">
          <div className="sq-list-title">{item.exam_title || item.exam_id || "Bloco misto"}</div>
          <div className="sq-list-meta">
            {formatScore(item.score_percent)} · estrategia {item.selection_strategy} · revisado em {formatDate(item.completed_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

function WeakAreaSummary({ tracks }: { tracks: WeakAreaTrack[] }) {
  if (!tracks.length) {
    return <div className="sq-empty">Sem historico suficiente para detectar lacunas ainda.</div>;
  }

  return (
    <div className="sq-progress-list">
      {tracks.map((track) => {
        const focus = track.focus_domain;
        const ratio = !track.attempted ? 0 : Math.min(100, Math.round((track.wrong / track.attempted) * 100));

        return (
          <div key={track.certification} className="sq-surface-block">
            <div className="sq-progress-head">
              <div>
                <div className="sq-list-title">{track.certification}</div>
                <div className="sq-progress-meta">{track.message}</div>
              </div>
              <div className="sq-progress-meta">{ratio}% de erros recentes</div>
            </div>
            <div className="sq-progress-track" aria-hidden="true">
              <div className="sq-progress-fill" style={{ width: `${ratio}%` }} />
            </div>
            <div className="sq-chip-row">
              {focus ? (
                <span className="sq-chip">
                  Foco: {focus.label} ({focus.wrong}/{focus.total})
                </span>
              ) : null}
              {track.domains.slice(0, 2).map((domain) => (
                <span key={`${track.certification}-${domain.label}`} className="sq-chip">
                  {domain.label} ({domain.wrong}/{domain.total})
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function InsightsPanel({
  weakAreas,
  studyOverview,
  examHistory,
  studyHistory,
  refreshing,
  onRefresh
}: InsightsPanelProps) {
  return (
    <div className="sq-grid-2">
      <Card
        title="Lacunas e dependencia por area"
        subtitle="Esse bloco traduz o historico atual em prioridade de estudo por certificacao."
        actions={
          <Button variant="ghost" size="sm" busy={refreshing} onClick={onRefresh}>
            Atualizar
          </Button>
        }
      >
        <WeakAreaSummary tracks={weakAreas} />
      </Card>

      <Card
        title="Fila de revisao e atividade"
        subtitle="Visibilidade rapida do que esta pendente e do que ja foi estudado."
      >
        <div className="sq-surface-block">
          <div className="sq-metric-grid">
            <div className="sq-metric-card">
              <span className="sq-muted">Revisoes vencidas</span>
              <strong>{studyOverview.due_review_count}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Simulados recentes</span>
              <strong>{examHistory.length}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Blocos de estudo</span>
              <strong>{studyHistory.length}</strong>
            </div>
          </div>

          <hr className="sq-divider" />

          <div className="sq-grid-2">
            <div className="sq-surface-block">
              <div className="sq-list-title">Ultimos simulados</div>
              <SessionSummary history={examHistory} />
            </div>
            <div className="sq-surface-block">
              <div className="sq-list-title">Ultimos blocos de estudo</div>
              <StudySummary history={studyHistory} />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
