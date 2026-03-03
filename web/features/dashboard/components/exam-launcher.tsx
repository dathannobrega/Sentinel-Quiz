import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { StatusBanner } from "@/components/ui/status-banner";
import type { DomainCatalogEntry, Exam } from "@/types/api";

import type { DashboardNotice, LaunchFormValues } from "@/features/dashboard/types";

interface ExamLauncherProps {
  exams: Exam[];
  domains: DomainCatalogEntry[];
  values: LaunchFormValues;
  notice: DashboardNotice | null;
  pending: boolean;
  onChange: (field: keyof LaunchFormValues, value: LaunchFormValues[keyof LaunchFormValues]) => void;
  onSubmit: () => void;
}

export function ExamLauncher({
  exams,
  domains,
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
      title="Comecar sessao"
      subtitle="Escolha o essencial e inicie em poucos segundos."
    >
      <div className="sq-surface-block">
        {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}

        <div className="sq-form-grid">
          <Field label="Certificacao" htmlFor="exam-id">
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

          <Field label="Modo" htmlFor="session-mode">
            <select
              id="session-mode"
              className="sq-select"
              value={values.mode}
              onChange={(event) => onChange("mode", event.target.value as LaunchFormValues["mode"])}
            >
              <option value="exam">Simulado</option>
              <option value="study">Estudo</option>
            </select>
          </Field>

          <Field label="Questoes" htmlFor="total-questions">
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

          {!isStudy ? (
            <Field label="Tempo (min)" htmlFor="time-limit-minutes">
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

        <details className="sq-disclosure sq-list-item" open={hasAdvancedFilters ? true : undefined}>
          <summary className="sq-disclosure__summary">
            Filtros avancados
            <span className="sq-chip">{hasAdvancedFilters ? "ativos" : "opcionais"}</span>
          </summary>

          <div className="sq-stack-md">
            <div className="sq-form-grid">
              <Field label="Dominio" htmlFor="exam-domain">
                <select
                  id="exam-domain"
                  className="sq-select"
                  value={values.domain}
                  onChange={(event) => onChange("domain", event.target.value)}
                  disabled={!domains.length}
                >
                  <option value="">Todos os dominios</option>
                  {domains.map((domain) => (
                    <option key={`${domain.value}-${domain.label}`} value={domain.value}>
                      {domain.label} ({domain.question_count})
                    </option>
                  ))}
                </select>
              </Field>

              {isStudy ? (
                <Field label="Estrategia" htmlFor="study-strategy">
                  <select
                    id="study-strategy"
                    className="sq-select"
                    value={values.studyStrategy}
                    onChange={(event) => onChange("studyStrategy", event.target.value as LaunchFormValues["studyStrategy"])}
                  >
                    <option value="standard">Padrao</option>
                    <option value="adaptive">Adaptativa</option>
                  </select>
                </Field>
              ) : (
                <Field label="Estrategia" htmlFor="exam-strategy">
                  <select
                    id="exam-strategy"
                    className="sq-select"
                    value={values.examStrategy}
                    onChange={(event) => onChange("examStrategy", event.target.value as LaunchFormValues["examStrategy"])}
                  >
                    <option value="standard">Padrao</option>
                    <option value="adaptive">Adaptativa</option>
                  </select>
                </Field>
              )}

              <Field label="Dificuldade" htmlFor="difficulty-query">
                <input
                  id="difficulty-query"
                  className="sq-input"
                  type="text"
                  value={values.difficultyQuery}
                  onChange={(event) => onChange("difficultyQuery", event.target.value)}
                />
              </Field>

              <Field label="Tags" htmlFor="tag-query">
                <input
                  id="tag-query"
                  className="sq-input"
                  type="text"
                  value={values.tagQuery}
                  onChange={(event) => onChange("tagQuery", event.target.value)}
                />
              </Field>
            </div>

            <div className="sq-checkbox-grid">
              {[
                ["bookmarkedOnly", "Marcadas"],
                ["notesOnly", "Com nota"],
                ["incorrectOnly", "Erradas"],
                ["unseenOnly", "Novas"],
                ["lowConfidenceOnly", "Baixa confianca"]
              ].map(([field, label]) => (
                <label key={field} className="sq-checkbox-row">
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
        </details>

        <div className="sq-actions">
          <Button busy={pending} disabled={!canLaunch} onClick={onSubmit}>
            {isStudy ? "Criar bloco de estudo" : "Criar simulado"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
