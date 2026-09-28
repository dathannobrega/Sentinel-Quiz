"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { saveBlobAsFile } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import {
  refreshAdminData,
  useAdminCaptureSnapshotMutation,
  useAdminExportMutation,
  useAdminIngestMutation
} from "@/lib/query/admin-hooks";

import type { AdminTask } from "@/features/admin/types";
import { readAdminError } from "@/features/admin/utils/admin-errors";

const EXPORT_FALLBACK_FILENAME = "sentinel-quiz-export.json";

type Notice = { tone: "neutral" | "success" | "danger"; message: string };

/** Toolbar operations: refresh, JSON reimport, database export and analytics snapshot. */
export function useAdminMaintenance({ canAdmin, canEdit }: { canAdmin: boolean; canEdit: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const ingestMutation = useAdminIngestMutation();
  const exportMutation = useAdminExportMutation();
  const snapshotMutation = useAdminCaptureSnapshotMutation();
  const [activeTask, setActiveTask] = useState<AdminTask | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function refresh() {
    setActiveTask("refresh");
    setNotice(null);
    try {
      await refreshAdminData(queryClient);
      setNotice({ tone: "success", message: t("admin.misc.panelRefreshed") });
    } catch (error) {
      setNotice({ tone: "danger", message: readAdminError(error, t, "admin.misc.panelLoadFailed") });
    } finally {
      setActiveTask(null);
    }
  }

  async function ingest() {
    if (!canAdmin) {
      setNotice({ tone: "danger", message: t("admin.misc.adminRequiredAction") });
      return;
    }
    const accepted = await confirm({
      title: t("admin.access.confirmIngestTitle"),
      message: t("admin.access.confirmIngestMessage"),
      confirmLabel: t("admin.access.confirmIngestAction"),
      tone: "danger"
    });
    if (!accepted) {
      return;
    }
    setActiveTask("ingest");
    setNotice(null);
    try {
      const response = await ingestMutation.mutateAsync();
      setNotice({
        tone: response?.errors?.length ? "neutral" : "success",
        message: t("admin.misc.ingestDone", {
          imported: response?.imported ?? 0,
          skipped: response?.skipped ?? 0,
          errors: response?.errors?.length ?? 0
        })
      });
    } catch (error) {
      setNotice({ tone: "danger", message: readAdminError(error, t, "admin.misc.ingestFailed") });
    } finally {
      setActiveTask(null);
    }
  }

  async function exportDatabase() {
    if (!canAdmin) {
      setNotice({ tone: "danger", message: t("admin.misc.adminRequiredAction") });
      return;
    }
    setActiveTask("export");
    setNotice(null);
    try {
      const file = await exportMutation.mutateAsync();
      saveBlobAsFile(file.blob, file.filename || EXPORT_FALLBACK_FILENAME);
      setNotice({ tone: "success", message: t("admin.misc.exportDone") });
    } catch (error) {
      setNotice({ tone: "danger", message: readAdminError(error, t, "admin.misc.exportFailed") });
    } finally {
      setActiveTask(null);
    }
  }

  async function captureSnapshot() {
    if (!canEdit) {
      setNotice({ tone: "danger", message: t("admin.misc.editorRequiredAction") });
      return;
    }
    setActiveTask("captureSnapshot");
    setNotice(null);
    try {
      const response = await snapshotMutation.mutateAsync();
      if (!response.schema_ready) {
        setNotice({ tone: "neutral", message: response.message || t("admin.misc.snapshotSchemaMissing") });
        return;
      }
      setNotice({
        tone: "success",
        message:
          response.snapshot_count > 0
            ? t("admin.misc.snapshotRecorded", { count: response.snapshot_count })
            : t("admin.misc.snapshotNone")
      });
    } catch (error) {
      setNotice({ tone: "danger", message: readAdminError(error, t, "admin.misc.snapshotFailed") });
    } finally {
      setActiveTask(null);
    }
  }

  return { activeTask, notice, refresh, ingest, exportDatabase, captureSnapshot, confirmDialog };
}
