"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CircleCheckIcon } from "@/components/ui/icons";
import { IssueList } from "@/features/quiz-builder/components/issue-list";
import { PresentIcon, UploadIcon } from "@/features/quiz-builder/components/icons";
import { isQuizInvalid } from "@/lib/api/live-authoring";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import type { LiveIssue, LivePublishResult } from "@/types/api";

interface PublishDialogProps {
  open: boolean;
  onClose: () => void;
  itemCount: number;
  scoredCount: number;
  localIssueCount: number;
  publish: () => Promise<LivePublishResult>;
  onSelectItem: (itemId: string) => void;
  onPresent: () => void;
}

type State =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "success"; result: LivePublishResult }
  | { kind: "invalid"; issues: LiveIssue[] }
  | { kind: "error"; message: string };

export function PublishDialog({ open, onClose, itemCount, scoredCount, localIssueCount, publish, onSelectItem, onPresent }: PublishDialogProps) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = state.kind === "publishing";

  function close() {
    if (busy) return;
    setState({ kind: "idle" });
    onClose();
  }

  async function run() {
    setState({ kind: "publishing" });
    try {
      const result = await publish();
      setState({ kind: "success", result });
    } catch (caught) {
      if (isQuizInvalid(caught)) {
        setState({ kind: "invalid", issues: caught.issues });
      } else {
        setState({ kind: "error", message: readErrorMessage(caught, t("quizBuilder.library.actionError")) });
      }
    }
  }

  const success = state.kind === "success" ? state.result : null;

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!busy}
      title={success ? t("quizBuilder.publish.success", { version: success.version_no }) : t("quizBuilder.publish.title")}
      description={success ? t("quizBuilder.publish.successMessage") : t("quizBuilder.publish.description")}
      className="w-[min(36rem,calc(100vw-2rem))]"
      footer={
        success ? (
          <>
            <Button variant="secondary" onClick={close}>
              {t("quizBuilder.publish.close")}
            </Button>
            <Button
              onClick={() => {
                setState({ kind: "idle" });
                onClose();
                onPresent();
              }}
            >
              <PresentIcon />
              {t("quizBuilder.publish.presentNow")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              {t("quizBuilder.create.cancel")}
            </Button>
            <Button onClick={() => void run()} busy={busy} busyLabel={t("quizBuilder.publish.publishing")}>
              <UploadIcon />
              {t("quizBuilder.publish.submit")}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {success ? (
          <div className="flex items-center gap-3 rounded-md border border-success/30 bg-success-soft p-4 motion-safe:animate-[pop-in_320ms_var(--ease-out)]">
            <CircleCheckIcon size={28} className="shrink-0 text-success" />
            <p className="text-[0.9375rem] font-semibold text-fg" role="status">
              {t("quizBuilder.publish.success", { version: success.version_no })}
            </p>
          </div>
        ) : state.kind !== "invalid" ? (
          <p className="text-sm text-fg">{t("quizBuilder.publish.ready", { count: itemCount })}</p>
        ) : null}

        {!success && scoredCount === 0 && itemCount > 0 ? (
          <Alert tone="warning" message={t("quizBuilder.publish.nothingScored")} />
        ) : null}

        {!success && localIssueCount > 0 && state.kind === "idle" ? (
          <Alert tone="warning" message={t("quizBuilder.rail.issues", { count: localIssueCount })} />
        ) : null}

        {state.kind === "invalid" ? (
          <IssueList
            issues={state.issues}
            tone="danger"
            title={t("quizBuilder.publish.issuesTitle")}
            description={t("quizBuilder.publish.issuesMessage")}
            onSelectItem={(itemId) => {
              setState({ kind: "idle" });
              onClose();
              onSelectItem(itemId);
            }}
          />
        ) : null}

        {success?.warnings.length ? (
          <IssueList
            issues={success.warnings}
            tone="warning"
            title={t("quizBuilder.publish.warningsTitle")}
            onSelectItem={(itemId) => {
              setState({ kind: "idle" });
              onClose();
              onSelectItem(itemId);
            }}
          />
        ) : null}

        {state.kind === "error" ? <Alert tone="danger" role="alert" message={state.message} /> : null}
      </div>
    </Dialog>
  );
}
