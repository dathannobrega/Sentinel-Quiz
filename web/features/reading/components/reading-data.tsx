"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DownloadIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/section";
import { exportReadingData, useDeleteReadingDataMutation } from "@/features/reading/hooks";
import { readErrorMessage, saveBlobAsFile } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import type { ReadingDataDeleted } from "@/types/api";

/** File name of the export ("sentinel-reading-2026-10-12.json"). */
export function exportFileName(date = new Date()): string {
  return `sentinel-reading-${date.toISOString().slice(0, 10)}.json`;
}

/** "Your data": export everything from Reading as JSON, or delete it all (with confirmation). */
export function ReadingDataSection() {
  const { t } = useI18n();
  const remove = useDeleteReadingDataMutation();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState<ReadingDataDeleted["deleted"] | null>(null);

  async function download() {
    setExporting(true);
    setExportError(null);
    try {
      const data = await exportReadingData();
      saveBlobAsFile(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), exportFileName());
    } catch (error) {
      setExportError(readErrorMessage(error, t("reading.data.exportFailed")));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Section title={t("reading.data.title")} description={t("reading.data.description")}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void download()} busy={exporting}>
          <DownloadIcon />
          {t("reading.data.export")}
        </Button>
        <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
          {t("reading.data.delete")}
        </Button>
      </div>
      {exportError ? <Alert tone="danger" role="alert" message={exportError} /> : null}
      {remove.isError ? <Alert tone="danger" role="alert" message={readErrorMessage(remove.error, t("reading.data.deleteFailed"))} /> : null}
      {deleted ? (
        <Alert
          tone="success"
          message={t("reading.data.deleted", {
            attempts: deleted.attempts,
            words: deleted.words,
            progress: deleted.progress,
            answers: deleted.quiz_answers
          })}
        />
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={t("reading.data.deleteTitle")}
        message={t("reading.data.deleteMessage")}
        confirmLabel={t("reading.data.deleteConfirm")}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: (result) => setDeleted(result.deleted),
            onSettled: () => setConfirming(false)
          })
        }
        onCancel={() => setConfirming(false)}
      />
    </Section>
  );
}
