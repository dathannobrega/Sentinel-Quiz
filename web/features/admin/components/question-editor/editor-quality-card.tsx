"use client";

import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusBanner } from "@/components/ui/status-banner";
import { useI18n } from "@/lib/i18n";

import type { AdminQuestionEditorState } from "@/features/admin/hooks/use-admin-question-editor";
import { qualityStatusKey, qualityTone } from "@/features/admin/utils/question-draft";

export function EditorQualityCard({ editor }: { editor: AdminQuestionEditorState }) {
  const { t } = useI18n();
  const quality = editor.questionQuality;

  return (
    <Card title={t("admin.form.qualityTitle")} subtitle={t("admin.form.qualitySubtitle")}>
      {quality ? (
        <div className="sq-page-stack">
          <div className="sq-metric-grid">
            <MetricCard label={t("admin.form.completeness")} value={`${quality.completeness_score}%`} />
            <MetricCard label={t("admin.form.publishReady")} value={quality.is_publish_ready ? t("admin.form.yes") : t("admin.form.no")} />
            <MetricCard label={t("admin.form.blockers")} value={quality.blocking_issues.length} />
            <MetricCard label={t("admin.form.warnings")} value={quality.warnings.length} />
          </div>

          {editor.isQualityStale ? (
            <StatusBanner tone="warning" title={t("admin.form.staleTitle")} message={t("admin.form.staleMessage")} />
          ) : null}

          {quality.blocking_issues.length ? (
            <StatusBanner tone="warning" title={t("admin.form.blockers")} message={quality.blocking_issues.join(" | ")} />
          ) : (
            <StatusBanner tone="success" title={t("admin.form.validTitle")} message={t("admin.form.validMessage")} />
          )}

          {quality.warnings.length ? (
            <div className="sq-surface-block">
              <div className="sq-list-title">{t("admin.form.improvementsTitle")}</div>
              <div className="sq-list" style={{ marginTop: "var(--sq-space-3)" }}>
                {quality.warnings.map((item) => (
                  <div key={item} className="sq-list-item">
                    <div className="sq-list-meta">{item}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="sq-surface-block">
            <div className="sq-list-title">{t("admin.form.fieldChecklistTitle")}</div>
            <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-3)" }}>
              {Object.entries(quality.field_status).map(([field, status]) => {
                const tone = qualityTone(status);
                const labelKey = qualityStatusKey(status);
                return (
                  <span
                    key={field}
                    className="sq-chip"
                    style={{
                      background:
                        tone === "good" ? "rgba(34, 197, 94, 0.12)" : tone === "warning" ? "rgba(245, 158, 11, 0.14)" : undefined,
                      borderColor:
                        tone === "good" ? "rgba(34, 197, 94, 0.25)" : tone === "warning" ? "rgba(245, 158, 11, 0.25)" : undefined
                    }}
                  >
                    {field}: {labelKey ? t(labelKey) : status}
                  </span>
                );
              })}
            </div>
          </div>

          {quality.blueprint?.certification || quality.blueprint?.blueprint_code || quality.blueprint?.objective_code ? (
            <div className="sq-surface-block">
              <div className="sq-list-title">{t("admin.form.linkedBlueprintTitle")}</div>
              <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-3)" }}>
                {quality.blueprint?.certification ? <span className="sq-chip">{quality.blueprint.certification}</span> : null}
                {quality.blueprint?.domain ? <span className="sq-chip">{quality.blueprint.domain}</span> : null}
                {quality.blueprint?.subdomain ? <span className="sq-chip">{quality.blueprint.subdomain}</span> : null}
                {quality.blueprint?.objective_code ? <span className="sq-chip">OBJ {quality.blueprint.objective_code}</span> : null}
                {quality.blueprint?.blueprint_code ? <span className="sq-chip">BP {quality.blueprint.blueprint_code}</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="sq-empty">{t("admin.editor.diagnosticsEmpty")}</div>
      )}
    </Card>
  );
}

export function EditorChecklistCards({ editor }: { editor: AdminQuestionEditorState }) {
  const { t } = useI18n();
  const payload = editor.questionPayload;
  const stats = useMemo(() => {
    const uniqueKeys = new Set(payload.options.map((item) => item.key));
    return [
      { label: t("admin.form.statsOptions"), value: String(payload.options.length) },
      { label: t("admin.form.statsCorrect"), value: String(payload.correct_keys.length) },
      { label: t("admin.form.statsTags"), value: String(payload.tags?.length || 0) },
      { label: t("admin.form.statsReferences"), value: String(payload.citations?.length || 0) },
      {
        label: t("admin.form.statsFormat"),
        value: payload.multi_select ? t("admin.form.multiSelect") : t("admin.form.singleSelect")
      },
      {
        label: t("admin.form.statsUniqueKeys"),
        value: uniqueKeys.size === payload.options.length ? t("admin.form.uniqueYes") : t("admin.form.uniqueNo")
      }
    ];
  }, [payload, t]);
  const preview = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  return (
    <>
      <Card title={t("admin.editor.quickChecklistTitle")} subtitle={t("admin.editor.quickChecklistSubtitle")}>
        <div className="sq-metric-grid">
          {stats.map((item) => (
            <MetricCard key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </Card>

      <Card title={t("admin.editor.payloadPreviewTitle")} subtitle={t("admin.editor.payloadPreviewSubtitle")}>
        <pre className="sq-editor-preview" tabIndex={0}>
          {preview}
        </pre>
      </Card>
    </>
  );
}
