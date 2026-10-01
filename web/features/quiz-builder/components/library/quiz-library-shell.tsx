"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page, PageHeader } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { CapabilityGate, resolveCannotHostReason } from "@/features/quiz-builder/components/capability-gate";
import { DatabaseIcon, PlusIcon, PresentIcon } from "@/features/quiz-builder/components/icons";
import { CreateQuizDialog } from "@/features/quiz-builder/components/library/create-quiz-dialog";
import { QuizCard } from "@/features/quiz-builder/components/library/quiz-card";
import { StartSessionDialog } from "@/features/quiz-builder/components/start-session-dialog";
import { CreateChallengeDialog } from "@/features/quiz-challenge/components/create-challenge-dialog";
import { ThemeSwatch } from "@/features/quiz-builder/components/theme-picker";
import { publishLiveQuiz } from "@/lib/api/live-authoring";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import {
  applyQuizDetail,
  useArchiveLiveQuiz,
  useDuplicateLiveQuiz,
  useLiveCapabilities,
  useLiveQuizzes
} from "@/lib/query/live-hooks";
import { useQueryClient } from "@tanstack/react-query";
import type { LiveCapabilities, LiveQuizSummary } from "@/types/api";

export function QuizLibraryShell() {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const capabilities = useLiveCapabilities();
  const canHost = Boolean(capabilities.data) && !resolveCannotHostReason(capabilities.data, capabilities.error);
  return (
    <Page width="wide">
      <PageHeader
        context={t("quizBuilder.library.context")}
        title={t("quizBuilder.library.title")}
        description={t("quizBuilder.library.description")}
        actions={
          canHost ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              {t("quizBuilder.library.newQuiz")}
            </Button>
          ) : null
        }
      />
      <CapabilityGate>
        {(capabilities) => (
          <LibraryContent capabilities={capabilities} createOpen={createOpen} setCreateOpen={setCreateOpen} />
        )}
      </CapabilityGate>
    </Page>
  );
}

function LibraryContent({
  capabilities,
  createOpen,
  setCreateOpen
}: {
  capabilities: LiveCapabilities;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const quizzes = useLiveQuizzes();
  const duplicate = useDuplicateLiveQuiz();
  const archive = useArchiveLiveQuiz();
  const [archiveTarget, setArchiveTarget] = useState<LiveQuizSummary | null>(null);
  const [presentTarget, setPresentTarget] = useState<LiveQuizSummary | null>(null);
  const [challengeTarget, setChallengeTarget] = useState<LiveQuizSummary | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; message: string } | null>(null);

  async function onDuplicate(quiz: LiveQuizSummary) {
    setNotice(null);
    try {
      const copy = await duplicate.mutateAsync(quiz.id);
      setNotice({ tone: "success", message: t("quizBuilder.library.duplicated", { title: copy.title }) });
    } catch (error) {
      setNotice({ tone: "danger", message: readErrorMessage(error, t("quizBuilder.library.actionError")) });
    }
  }

  async function onArchiveConfirmed() {
    if (!archiveTarget) {
      return;
    }
    setNotice(null);
    try {
      await archive.mutateAsync(archiveTarget.id);
      setNotice({ tone: "success", message: t("quizBuilder.library.archived") });
    } catch (error) {
      setNotice({ tone: "danger", message: readErrorMessage(error, t("quizBuilder.library.actionError")) });
    } finally {
      setArchiveTarget(null);
    }
  }

  const list = quizzes.data ?? [];

  return (
    <>
      {notice ? <Alert tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"} message={notice.message} /> : null}

      {quizzes.isPending ? (
        <ul aria-busy="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
              <Skeleton height={140} />
              <Skeleton height={18} className="w-3/4" />
              <Skeleton height={14} className="w-1/2" />
            </li>
          ))}
        </ul>
      ) : quizzes.isError ? (
        <QueryErrorBanner
          error={quizzes.error}
          title={t("quizBuilder.library.loadError")}
          onRetry={() => void quizzes.refetch()}
          retrying={quizzes.isFetching}
        />
      ) : list.length === 0 ? (
        <LibraryEmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <section aria-label={t("quizBuilder.library.count", { count: list.length })}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((quiz, index) => (
              <QuizCard
                key={quiz.id}
                quiz={quiz}
                index={index}
                busy={(duplicate.isPending && duplicate.variables === quiz.id) || (archive.isPending && archive.variables === quiz.id)}
                onPresent={setPresentTarget}
                onChallenge={setChallengeTarget}
                onDuplicate={(target) => void onDuplicate(target)}
                onArchive={setArchiveTarget}
              />
            ))}
          </ul>
        </section>
      )}

      <CreateQuizDialog open={createOpen} onClose={() => setCreateOpen(false)} themes={capabilities.themes} />

      <ConfirmDialog
        open={archiveTarget !== null}
        title={t("quizBuilder.library.archiveConfirm.title", { title: archiveTarget?.title ?? "" })}
        message={t("quizBuilder.library.archiveConfirm.message")}
        confirmLabel={t("quizBuilder.library.archiveConfirm.confirm")}
        tone="danger"
        busy={archive.isPending}
        onConfirm={() => void onArchiveConfirmed()}
        onCancel={() => setArchiveTarget(null)}
      />

      {presentTarget ? (
        <StartSessionDialog
          open
          onClose={() => setPresentTarget(null)}
          quiz={presentTarget}
          maxParticipants={capabilities.limits.max_participants}
          publish={async () => {
            const result = await publishLiveQuiz(presentTarget.id, presentTarget.version);
            applyQuizDetail(queryClient, result.quiz);
            return result;
          }}
        />
      ) : null}

      {challengeTarget ? <CreateChallengeDialog open onClose={() => setChallengeTarget(null)} quiz={challengeTarget} /> : null}
    </>
  );
}

function LibraryEmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  const steps = [
    { icon: PlusIcon, label: t("quizBuilder.library.empty.stepCreate") },
    { icon: DatabaseIcon, label: t("quizBuilder.library.empty.stepBuild") },
    { icon: PresentIcon, label: t("quizBuilder.library.empty.stepPresent") }
  ];
  return (
    <section className="grid items-center gap-8 overflow-hidden rounded-lg border border-line bg-surface p-6 sm:p-10 lg:grid-cols-[1.1fr_1fr] motion-safe:animate-[rise-in_320ms_var(--ease-out)]">
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{t("quizBuilder.library.empty.title")}</h2>
        <p className="max-w-prose text-[0.9375rem] leading-relaxed text-fg-muted">{t("quizBuilder.library.empty.message")}</p>
        <ol className="flex flex-col gap-2.5">
          {steps.map(({ icon: Icon, label }, index) => (
            <li key={label} className="flex items-center gap-3 text-sm text-fg">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                <Icon />
              </span>
              <span>
                <span className="sr-only">{index + 1}. </span>
                {label}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-2">
          <Button size="lg" onClick={onCreate}>
            <PlusIcon />
            {t("quizBuilder.library.empty.cta")}
          </Button>
        </div>
      </div>
      <div aria-hidden="true" className="relative mx-auto aspect-[4/3] w-full max-w-md">
        <ThemeSwatch
          themeKey="sentinel"
          className="absolute top-0 left-0 w-[70%] shadow-overlay motion-safe:animate-[rise-in_420ms_var(--ease-out)_both]"
        />
        <ThemeSwatch
          themeKey="neon_soc"
          className="absolute top-[30%] right-0 w-[55%] shadow-overlay motion-safe:animate-[rise-in_520ms_var(--ease-out)_both]"
        />
        <ThemeSwatch
          themeKey="terminal"
          className="absolute bottom-0 left-[12%] w-[50%] shadow-overlay motion-safe:animate-[rise-in_620ms_var(--ease-out)_both]"
        />
      </div>
    </section>
  );
}
