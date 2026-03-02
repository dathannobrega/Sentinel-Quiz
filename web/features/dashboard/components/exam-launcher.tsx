import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { StatusBanner } from "@/components/ui/status-banner";
import type { DomainCatalogEntry, Exam, HealthResponse } from "@/types/api";

import type { DashboardNotice, LaunchFormValues } from "@/features/dashboard/types";

interface ExamLauncherProps {
  health: HealthResponse | null;
  exams: Exam[];
  domains: DomainCatalogEntry[];
  apiOriginLabel: string;
  values: LaunchFormValues;
  notice: DashboardNotice | null;
  pending: boolean;
  onChange: (field: keyof LaunchFormValues, value: LaunchFormValues[keyof LaunchFormValues]) => void;
  onSubmit: () => void;
}

export function ExamLauncher({
  health,
  exams,
  domains,
  apiOriginLabel,
  values,
  notice,
  pending,
  onChange,
  onSubmit
}: ExamLauncherProps) {
  const isStudy = values.mode === "study";
  const canLaunch = values.totalQuestions > 0;
  const hasAdvancedFilters =
    values.bookmarkedOnly || values.notesOnly || values.incorrectOnly || values.unseenOnly || values.lowConfidenceOnly;

  return (
    <Card
      title="Configurar prova"
      subtitle="A jornada principal agora inicia e continua no frontend Next, sem dependencias do frontend legado."
    >
      <div className="sq-surface-block">
        {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}

        <div className="sq-form-grid">
          <Field label="Prova" htmlFor="exam-id" hint="Misturar tudo continua permitido no backend.">
            <select
              id="exam-id"
              className="sq-select"
              value={values.examId}
              onChange={(event) => onChange("examId", event.target.value)}
            >
              <option value="">Misturar todas (random)</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Assunto"
            htmlFor="exam-domain"
            hint={domains.length ? "Filtro opcional por dominio alinhado ao catalogo atual." : "Sem dominios para o filtro atual."}
          >
            <select
              id="exam-domain"
              className="sq-select"
              value={values.domain}
              onChange={(event) => onChange("domain", event.target.value)}
              disabled={!domains.length}
            >
              <option value="">Todos os assuntos</option>
              {domains.map((domain) => (
                <option key={`${domain.value}-${domain.label}`} value={domain.value}>
                  {domain.label} ({domain.question_count})
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Modo"
            htmlFor="session-mode"
            hint={
              isStudy
                ? "Study mode registra confianca e alimenta a fila de revisao."
                : "Exam mode simula prova e pode ser adaptativo."
            }
          >
            <select
              id="session-mode"
              className="sq-select"
              value={values.mode}
              onChange={(event) => onChange("mode", event.target.value as LaunchFormValues["mode"])}
            >
              <option value="exam">Exam mode</option>
              <option value="study">Study mode</option>
            </select>
          </Field>

          {isStudy ? (
            <Field
              label="Estrategia"
              htmlFor="study-strategy"
              hint="Padrao para distribuicao mais ampla ou adaptativo para puxar fila vencida e pontos fracos."
            >
              <select
                id="study-strategy"
                className="sq-select"
                value={values.studyStrategy}
                onChange={(event) => onChange("studyStrategy", event.target.value as LaunchFormValues["studyStrategy"])}
              >
                <option value="standard">Study padrao</option>
                <option value="adaptive">Study adaptativo</option>
              </select>
            </Field>
          ) : (
            <Field
              label="Estrategia"
              htmlFor="exam-strategy"
              hint="O modo adaptativo prioriza dominios fracos e itens com mais necessidade de revisao."
            >
              <select
                id="exam-strategy"
                className="sq-select"
                value={values.examStrategy}
                onChange={(event) => onChange("examStrategy", event.target.value as LaunchFormValues["examStrategy"])}
              >
                <option value="standard">Simulado padrao</option>
                <option value="adaptive">Simulado adaptativo</option>
              </select>
            </Field>
          )}

          <Field
            label="Quantidade de questoes"
            htmlFor="total-questions"
            hint="O backend continua ajustando automaticamente se o pool tiver menos itens."
          >
            <input
              id="total-questions"
              className="sq-input"
              type="number"
              min={1}
              max={isStudy ? 120 : 180}
              value={values.totalQuestions}
              onChange={(event) => onChange("totalQuestions", Number(event.target.value || 0))}
            />
          </Field>

          <Field
            label="Dificuldade"
            htmlFor="difficulty-query"
            hint="Opcional. Informe uma ou mais separadas por virgula. Ex.: easy, medium, hard."
          >
            <input
              id="difficulty-query"
              className="sq-input"
              type="text"
              value={values.difficultyQuery}
              onChange={(event) => onChange("difficultyQuery", event.target.value)}
            />
          </Field>

          <Field
            label="Tags"
            htmlFor="tag-query"
            hint="Opcional. Combine por objetivo, blueprint ou palavra-chave."
          >
            <input
              id="tag-query"
              className="sq-input"
              type="text"
              value={values.tagQuery}
              onChange={(event) => onChange("tagQuery", event.target.value)}
            />
          </Field>

          {!isStudy ? (
            <Field
              label="Tempo (min)"
              htmlFor="time-limit-minutes"
              hint="Timer real no backend, com pausa controlada e auto-submit no timeout."
            >
              <input
                id="time-limit-minutes"
                className="sq-input"
                type="number"
                min={5}
                max={360}
                value={values.timeLimitMinutes}
                onChange={(event) => onChange("timeLimitMinutes", Number(event.target.value || 0))}
              />
            </Field>
          ) : null}
        </div>

        <div className="sq-list-item" style={{ marginTop: "var(--sq-space-4)" }}>
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">Filtros combinaveis</div>
              <div className="sq-list-meta">
                Use estes flags para montar blocos por backlog real: erradas, novas, marcadas ou baixa confianca.
              </div>
            </div>
            {hasAdvancedFilters ? <span className="sq-chip">ativos</span> : <span className="sq-chip">opcionais</span>}
          </div>

          <div
            style={{
              display: "grid",
              gap: "var(--sq-space-3)",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              marginTop: "var(--sq-space-3)"
            }}
          >
            {[
              ["bookmarkedOnly", "Marcadas"],
              ["notesOnly", "Com nota"],
              ["incorrectOnly", "Erradas"],
              ["unseenOnly", "Novas"],
              ["lowConfidenceOnly", "Baixa confianca"]
            ].map(([field, label]) => (
              <label
                key={field}
                style={{ display: "flex", alignItems: "center", gap: "var(--sq-space-2)", fontWeight: 700 }}
              >
                <input
                  type="checkbox"
                  checked={values[field as keyof LaunchFormValues] as boolean}
                  onChange={(event) => onChange(field as keyof LaunchFormValues, event.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="sq-actions">
          <Button busy={pending} disabled={!canLaunch} onClick={onSubmit}>
            {isStudy ? "Criar bloco de estudo" : "Criar simulado"}
          </Button>
        </div>

        <div className="sq-empty">
          Backend conectado em <strong>{apiOriginLabel}</strong>. IA:{" "}
          {health?.ai_enabled ? `habilitada (${health.ai_model || "modelo padrao"})` : "desligada"}.
        </div>
      </div>
    </Card>
  );
}
