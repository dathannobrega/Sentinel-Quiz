"use client";

import { useMemo } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { Meter } from "@/components/ui/meter";
import { Panel } from "@/components/ui/section";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

import type { AdminQuestionEditorState } from "@/features/admin/hooks/use-admin-question-editor";
import { qualityStatusKey, qualityTone } from "@/features/admin/utils/question-draft";

export function EditorQualityCard({ editor }: { editor: AdminQuestionEditorState }) {
  const { t } = useI18n();
  const quality = editor.questionQuality;

  return (
    <Panel title={t("admin.form.qualityTitle")} description={t("admin.form.qualitySubtitle")} level={3}>
      {quality ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-fg-muted">{t("admin.form.completeness")}</span>
              <span className="nums font-semibold text-fg">{quality.completeness_score}%</span>
            </div>
            <Meter value={quality.completeness_score} kind="score" label={t("admin.form.completeness")} />
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-fg-muted">{t("admin.form.publishReady")}</dt>
              <dd className={cn("font-semibold", quality.is_publish_ready ? "text-success" : "text-fg")}>
                {quality.is_publish_ready ? t("admin.form.yes") : t("admin.form.no")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">{t("admin.form.blockers")}</dt>
              <dd className="nums font-semibold text-fg">{quality.blocking_issues.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">{t("admin.form.warnings")}</dt>
              <dd className="nums font-semibold text-fg">{quality.warnings.length}</dd>
            </div>
          </dl>

          {editor.isQualityStale ? <Alert tone="warning" title={t("admin.form.staleTitle")} message={t("admin.form.staleMessage")} /> : null}

          {quality.blocking_issues.length ? (
            <Alert tone="warning" title={t("admin.form.blockers")} message={quality.blocking_issues.join(" | ")} />
          ) : (
            <Alert tone="success" title={t("admin.form.validTitle")} message={t("admin.form.validMessage")} />
          )}

          {quality.warnings.length ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-fg-muted">{t("admin.form.improvementsTitle")}</p>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-[0.8125rem] leading-snug text-fg marker:text-fg-subtle">
                {quality.warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-fg-muted">{t("admin.form.fieldChecklistTitle")}</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(quality.field_status).map(([field, status]) => {
                const tone = qualityTone(status);
                const labelKey = qualityStatusKey(status);
                return (
                  <Badge key={field} tone={tone === "good" ? "success" : tone === "warning" ? "warning" : "neutral"}>
                    {field}: {labelKey ? t(labelKey) : status}
                  </Badge>
                );
              })}
            </div>
          </div>

          {quality.blueprint?.certification || quality.blueprint?.blueprint_code || quality.blueprint?.objective_code ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-fg-muted">{t("admin.form.linkedBlueprintTitle")}</p>
              <p className="text-[0.8125rem] leading-snug text-fg">
                {[
                  quality.blueprint?.certification,
                  quality.blueprint?.domain,
                  quality.blueprint?.subdomain,
                  quality.blueprint?.objective_code ? `OBJ ${quality.blueprint.objective_code}` : null,
                  quality.blueprint?.blueprint_code ? `BP ${quality.blueprint.blueprint_code}` : null
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">{t("admin.editor.diagnosticsEmpty")}</p>
      )}
    </Panel>
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
      <Disclosure summary={t("admin.editor.quickChecklistTitle")} hint={t("admin.editor.quickChecklistSubtitle")}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {stats.map((item) => (
            <div key={item.label}>
              <dt className="text-xs text-fg-muted">{item.label}</dt>
              <dd className="nums text-sm font-semibold text-fg">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>

      <Disclosure summary={t("admin.editor.payloadPreviewTitle")} hint={t("admin.editor.payloadPreviewSubtitle")}>
        <pre
          className="focus-ring max-h-80 overflow-auto rounded-md bg-surface-muted p-3 font-mono text-xs leading-relaxed text-fg"
          tabIndex={0}
        >
          {preview}
        </pre>
      </Disclosure>
    </>
  );
}
