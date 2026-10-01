"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ArrowLeftIcon, CircleCheckIcon, SettingsIcon } from "@/components/ui/icons";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { CapabilityGate } from "@/features/quiz-builder/components/capability-gate";
import { AiEmptyState } from "@/features/quiz-builder/components/ai/ai-empty-state";
import { AiGenerateDialog, type AiDialogTab } from "@/features/quiz-builder/components/ai/ai-generate-dialog";
import { ItemAiPanel } from "@/features/quiz-builder/components/ai/ai-item-panel";
import { AiButton } from "@/features/quiz-builder/components/ai/ai-shared";
import { BankPickerDialog } from "@/features/quiz-builder/components/editor/bank-picker-dialog";
import { ItemProperties } from "@/features/quiz-builder/components/editor/item-properties";
import { PublishDialog } from "@/features/quiz-builder/components/editor/publish-dialog";
import { QuestionRail } from "@/features/quiz-builder/components/editor/question-rail";
import { SaveStatus } from "@/features/quiz-builder/components/editor/save-status";
import { SettingsDrawer } from "@/features/quiz-builder/components/editor/settings-drawer";
import { StagePreview } from "@/features/quiz-builder/components/editor/stage-preview";
import { TypePickerDialog } from "@/features/quiz-builder/components/editor/type-picker-dialog";
import { ChallengeIcon, PresentIcon, SparklesIcon, UploadIcon } from "@/features/quiz-builder/components/icons";
import { StartSessionDialog } from "@/features/quiz-builder/components/start-session-dialog";
import { CreateChallengeDialog } from "@/features/quiz-challenge/components/create-challenge-dialog";
import { QUIZ_KEY, useEditorAutosave, type QuizPatch } from "@/features/quiz-builder/hooks/use-editor-autosave";
import {
  applyItemPatch,
  defaultItemWrite,
  itemToWrite,
  moveInArray,
  scoredItemCount,
  validateItem
} from "@/features/quiz-builder/lib/items";
import { AI_ITEM_TYPES, clampPct, isAiItemType, isJobActive, resolveAiUnavailable } from "@/features/quiz-builder/lib/ai";
import { CHAR_LIMITS, charLength } from "@/features/quiz-builder/lib/limits";
import { ApiError, readErrorMessage } from "@/lib/api/client";
import {
  addLiveItemsFromBank,
  createLiveItem,
  deleteLiveItem,
  isConfirmKeyRequired,
  isVersionConflict,
  publishLiveQuiz,
  reorderLiveItems,
  reviewLiveItem
} from "@/lib/api/live-authoring";
import { useI18n } from "@/lib/i18n";
import { useAiCapabilities, useAiJob, useApplyAiJob } from "@/lib/query/ai-hooks";
import { liveKeys, useLiveQuiz, useQuizMutator } from "@/lib/query/live-hooks";
import { cn } from "@/lib/utils/cn";
import type { LiveCapabilities, LiveItem, LiveItemType, LiveItemWrite, LiveQuizDetail } from "@/types/api";

export function QuizEditorShell({ quizId }: { quizId: string }) {
  return (
    <main className="mx-auto flex w-full max-w-[112rem] flex-col gap-5 px-4 pt-5 pb-16 sm:px-6 lg:px-8">
      <CapabilityGate>{(capabilities) => <QuizEditor key={quizId} quizId={quizId} capabilities={capabilities} />}</CapabilityGate>
    </main>
  );
}

type Dialogs = "type" | "bank" | "ai" | "settings" | "publish" | "present" | "challenge" | null;

function QuizEditor({ quizId, capabilities }: { quizId: string; capabilities: LiveCapabilities }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const quizQuery = useLiveQuiz(quizId);
  const mutator = useQuizMutator(quizId);
  const autosave = useEditorAutosave(quizId, mutator);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [deleteTarget, setDeleteTarget] = useState<LiveItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  // AI authoring (Incremento 2): the generation shown in the dialog and one improvement per item.
  const [aiTab, setAiTab] = useState<AiDialogTab>("topic");
  const [aiJobId, setAiJobId] = useState<string | null>(null);
  const [improveJobs, setImproveJobs] = useState<Record<string, string>>({});

  const server = quizQuery.data;
  const canEdit = Boolean(server?.can_edit);
  const aiCapabilities = useAiCapabilities({ enabled: canEdit });
  const aiUnavailable = resolveAiUnavailable(aiCapabilities.data, aiCapabilities.error);
  const trackedJob = useAiJob(aiJobId).data;
  const applyAi = useApplyAiJob(quizId, mutator, { beforeApply: () => autosave.saver.flush() });

  // What the editor renders: server state ⊕ in-flight ⊕ pending patches (typing never waits).
  const quiz: LiveQuizDetail | undefined = useMemo(() => {
    if (!server) return undefined;
    const quizOverlay = autosave.overlay(QUIZ_KEY) as QuizPatch | undefined;
    const base: LiveQuizDetail = quizOverlay
      ? {
          ...server,
          ...(quizOverlay.title !== undefined ? { title: quizOverlay.title } : {}),
          ...(quizOverlay.description !== undefined ? { description: quizOverlay.description ?? null } : {}),
          ...(quizOverlay.language !== undefined ? { language: quizOverlay.language } : {}),
          ...(quizOverlay.theme_key !== undefined ? { theme_key: quizOverlay.theme_key } : {}),
          settings: { ...server.settings, ...(quizOverlay.settings ?? {}) }
        }
      : server;
    return { ...base, items: server.items.map((item) => applyItemPatch(item, autosave.overlay(item.id) as LiveItemWrite | undefined)) };
  }, [server, autosave]);

  const items = useMemo(() => quiz?.items ?? [], [quiz]);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const selectedIndex = selected ? items.indexOf(selected) : -1;
  const readOnly = server ? !server.can_edit : true;
  const busy = mutator.busy > 0;

  const issuesById = useMemo(() => {
    const map: Record<string, ReturnType<typeof validateItem>> = {};
    for (const item of items) map[item.id] = validateItem(item);
    return map;
  }, [items]);
  const issueCounts = useMemo(
    () => Object.fromEntries(Object.entries(issuesById).map(([id, list]) => [id, list.length])),
    [issuesById]
  );
  const localIssueCount = Object.values(issueCounts).reduce((sum, count) => sum + count, 0);

  const reportError = useCallback(
    (error: unknown) => {
      if (isVersionConflict(error)) return; // handled by the conflict banner
      if (isConfirmKeyRequired(error)) {
        setNotice(t("quizAi.keyConfirm.required"));
        return;
      }
      setNotice(t("quizBuilder.editor.mutationError", { message: readErrorMessage(error, t("quizBuilder.library.actionError")) }));
    },
    [t]
  );

  /** Saves pending edits first, so structural changes and publish see the latest content. */
  const flushThen = useCallback(
    async <T,>(task: () => Promise<T>): Promise<T> => {
      await autosave.saver.flush();
      return task();
    },
    [autosave.saver]
  );

  // ---- structural actions -------------------------------------------------

  async function addItem(type: LiveItemType) {
    setDialog(null);
    setNotice(null);
    const before = new Set(items.map((item) => item.id));
    try {
      const detail = await flushThen(() =>
        mutator.run((version) =>
          createLiveItem(
            quizId,
            version,
            defaultItemWrite(type, { true: t("quizBuilder.properties.trueLabel"), false: t("quizBuilder.properties.falseLabel") }),
            // 0-based insertion index: right after the selected question (append when none).
            selectedIndex >= 0 ? selectedIndex + 1 : undefined
          )
        )
      );
      const created = detail.items.find((item) => !before.has(item.id));
      if (created) setSelectedId(created.id);
    } catch (error) {
      reportError(error);
    }
  }

  async function duplicateItem(item: LiveItem) {
    setNotice(null);
    const before = new Set(items.map((entry) => entry.id));
    const index = items.findIndex((entry) => entry.id === item.id);
    try {
      const detail = await flushThen(() => mutator.run((version) => createLiveItem(quizId, version, itemToWrite(item), index + 1)));
      const created = detail.items.find((entry) => !before.has(entry.id));
      if (created) setSelectedId(created.id);
    } catch (error) {
      reportError(error);
    }
  }

  async function moveItem(from: number, to: number) {
    const current = queryClient.getQueryData<LiveQuizDetail>(liveKeys.quiz(quizId))?.items ?? [];
    const reordered = moveInArray(current, from, to);
    const ids = reordered.map((item) => item.id);
    // Optimistic: show the new order immediately; the response (full QuizDetail) replaces it.
    queryClient.setQueryData<LiveQuizDetail>(liveKeys.quiz(quizId), (current) =>
      current ? { ...current, items: ids.map((id) => current.items.find((item) => item.id === id)).filter((item): item is LiveItem => Boolean(item)) } : current
    );
    try {
      await mutator.run((version) => reorderLiveItems(quizId, version, ids));
    } catch (error) {
      if (!isVersionConflict(error)) {
        void queryClient.invalidateQueries({ queryKey: liveKeys.quiz(quizId) });
      }
      reportError(error);
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setNotice(null);
    autosave.saver.discard(target.id);
    const index = items.findIndex((item) => item.id === target.id);
    try {
      await mutator.run((version) => deleteLiveItem(quizId, target.id, version));
      const neighbour = items[index + 1] ?? items[index - 1] ?? null;
      setSelectedId(neighbour && neighbour.id !== target.id ? neighbour.id : null);
    } catch (error) {
      reportError(error);
    } finally {
      setDeleteTarget(null);
    }
  }

  async function reviewItem(item: LiveItem, confirmKey: boolean) {
    setReviewingId(item.id);
    setNotice(null);
    try {
      await flushThen(() => mutator.run((version) => reviewLiveItem(quizId, item.id, version, { confirmKey })));
    } catch (error) {
      reportError(error);
    } finally {
      setReviewingId(null);
    }
  }

  const addFromBank = useCallback(
    async (questionIds: string[]) => {
      const before = new Set((queryClient.getQueryData<LiveQuizDetail>(liveKeys.quiz(quizId))?.items ?? []).map((item) => item.id));
      const result = await flushThen(() =>
        mutator.run(
          (version) => addLiveItemsFromBank(quizId, version, questionIds),
          (response) => response.quiz
        )
      );
      const created = result.quiz.items.filter((item) => !before.has(item.id));
      if (created[0]) setSelectedId(created[0].id);
      return result;
    },
    [flushThen, mutator, queryClient, quizId]
  );

  // ---- AI ----------------------------------------------------------------

  const openAi = useCallback((tab: AiDialogTab = "topic") => {
    setAiTab(tab);
    setDialog("ai");
  }, []);

  /** Adds generated drafts through the serialized mutator; resolves with the created item ids. */
  const applyDrafts = useCallback(
    async (jobId: string, indexes: number[], force: boolean) => {
      const before = new Set((queryClient.getQueryData<LiveQuizDetail>(liveKeys.quiz(quizId))?.items ?? []).map((item) => item.id));
      const detail = await applyAi.mutateAsync({ jobId, indexes, force });
      return detail.items.filter((item) => !before.has(item.id)).map((item) => item.id);
    },
    [applyAi, queryClient, quizId]
  );

  const applyImprovement = useCallback(
    async (jobId: string) => {
      await applyAi.mutateAsync({ jobId, indexes: [0] });
    },
    [applyAi]
  );

  const setImproveJob = useCallback((itemId: string, jobId: string | null) => {
    setImproveJobs((current) => {
      const next = { ...current };
      if (jobId) next[itemId] = jobId;
      else delete next[itemId];
      return next;
    });
  }, []);

  const publish = useCallback(
    () =>
      flushThen(() =>
        mutator.run(
          (version) => publishLiveQuiz(quizId, version),
          (result) => result.quiz
        )
      ),
    [flushThen, mutator, quizId]
  );

  // ---- render -------------------------------------------------------------

  if (quizQuery.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <Skeleton height={56} />
        <div className="grid gap-6 xl:grid-cols-[16rem_minmax(0,1fr)_22rem]">
          <Skeleton height={420} />
          <Skeleton height={420} />
          <Skeleton height={420} />
        </div>
      </div>
    );
  }

  if (quizQuery.isError || !quiz || !server) {
    const notFound = quizQuery.error instanceof ApiError && quizQuery.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <QueryErrorBanner
          error={quizQuery.error}
          title={notFound ? t("quizBuilder.editor.notFound") : t("quizBuilder.editor.loadError")}
          onRetry={notFound ? undefined : () => void quizQuery.refetch()}
          retrying={quizQuery.isFetching}
        />
      </div>
    );
  }

  const conflict = autosave.snapshot.status === "conflict" || mutator.conflict;
  const aiItemTypes = AI_ITEM_TYPES.filter((type) => capabilities.item_types.includes(type));
  const capacity = Math.max(0, capabilities.limits.max_items - items.length);
  const aiRunning = trackedJob && isJobActive(trackedJob.status) ? trackedJob : null;
  const hasPendingEdits = Object.keys(autosave.snapshot.pending).length > 0;
  const titleTooLong = charLength(quiz.title) > CHAR_LIMITS.title.max;

  return (
    <div className="flex flex-col gap-5" aria-label={t("quizBuilder.editor.layoutLabel")}>
      {/* Header: title, publish state, save status, actions */}
      <header className="flex flex-col gap-3 border-b border-line pb-4">
        <BackLink />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="quiz-title" className="sr-only">
              {t("quizBuilder.editor.titleLabel")}
            </label>
            <input
              id="quiz-title"
              value={quiz.title}
              readOnly={readOnly}
              aria-invalid={!quiz.title.trim() || titleTooLong ? true : undefined}
              onChange={(event) => autosave.scheduleQuiz({ title: event.target.value })}
              className="focus-ring -mx-2 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold tracking-[-0.01em] text-fg hover:border-line focus:border-primary focus:outline-none aria-invalid:border-danger"
            />
            <div className="flex flex-wrap items-center gap-2">
              {server.published_version_no !== null ? (
                <Badge tone="success">
                  <CircleCheckIcon />
                  {t("quizBuilder.editor.versionBadge", { version: server.published_version_no })}
                </Badge>
              ) : (
                <Badge tone="neutral">{t("quizBuilder.editor.neverPublished")}</Badge>
              )}
              {server.has_unpublished_changes && server.published_version_no !== null ? (
                <Badge tone="warning">{t("quizBuilder.editor.unpublished")}</Badge>
              ) : null}
              <SaveStatus status={autosave.snapshot.status} busy={busy} onRetry={() => void autosave.saver.resume()} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly ? (
              <AiButton onClick={() => openAi(aiUnavailable ? "bank" : "topic")} aria-describedby={aiRunning ? "ai-header-progress" : undefined}>
                <SparklesIcon className={aiRunning ? "motion-safe:animate-[pulse-soft_1.2s_ease-in-out_infinite]" : undefined} />
                {aiRunning ? t("quizAi.entry.running") : t("quizAi.entry.generate")}
                {aiRunning ? (
                  <span id="ai-header-progress" className="nums rounded-sm bg-primary-soft px-1.5 font-mono text-xs">
                    {clampPct(aiRunning.progress?.pct)}%
                  </span>
                ) : null}
              </AiButton>
            ) : null}
            <Button variant="ghost" onClick={() => setDialog("settings")}>
              <SettingsIcon />
              {t("quizBuilder.editor.settings")}
            </Button>
            <Link href={`/quizzes/${encodeURIComponent(quizId)}/sessions`} className={buttonClassName("ghost", "md")}>
              {t("quizBuilder.editor.sessions")}
            </Link>
            {!readOnly ? (
              <Button variant="secondary" onClick={() => setDialog("publish")} disabled={items.length === 0}>
                <UploadIcon />
                {t("quizBuilder.editor.publish")}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => setDialog("challenge")}
              disabled={items.length === 0 || server.published_version_no === null}
              title={server.published_version_no === null ? t("quizChallenge.create.mustPublish") : undefined}
            >
              <ChallengeIcon />
              {t("quizChallenge.create.title")}
            </Button>
            <Button onClick={() => setDialog("present")} disabled={items.length === 0}>
              <PresentIcon />
              {t("quizBuilder.editor.present")}
            </Button>
          </div>
        </div>
      </header>

      {readOnly ? <Alert tone="neutral" message={t("quizBuilder.editor.readOnly")} /> : null}

      {conflict ? (
        <Alert
          tone="warning"
          role="alert"
          title={t("quizBuilder.editor.conflict.title")}
          message={t("quizBuilder.editor.conflict.message")}
          action={
            hasPendingEdits ? (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    mutator.dismissConflict();
                    void autosave.saver.resume();
                  }}
                >
                  {t("quizBuilder.editor.conflict.apply")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    autosave.saver.discard();
                    mutator.dismissConflict();
                  }}
                >
                  {t("quizBuilder.editor.conflict.discard")}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  autosave.saver.discard();
                  mutator.dismissConflict();
                }}
              >
                {t("quizBuilder.editor.conflict.dismiss")}
              </Button>
            )
          }
        />
      ) : null}

      {notice ? (
        <Alert
          tone="danger"
          role="alert"
          message={notice}
          action={
            <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
              {t("quizBuilder.editor.conflict.dismiss")}
            </Button>
          }
        />
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_minmax(20rem,24rem)]">
        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:pr-1">
          <QuestionRail
            items={items}
            selectedId={selected?.id ?? null}
            issueCounts={issueCounts}
            maxItems={capabilities.limits.max_items}
            readOnly={readOnly}
            busy={false}
            onSelect={setSelectedId}
            onMove={(from, to) => void flushThen(() => moveItem(from, to))}
            onAdd={() => setDialog("type")}
            onAddFromBank={() => setDialog("bank")}
            onGenerateAi={readOnly ? undefined : () => openAi(aiUnavailable ? "bank" : "topic")}
            onDuplicate={(item) => void duplicateItem(item)}
            onDelete={setDeleteTarget}
          />
        </div>

        <section className="min-w-0 xl:sticky xl:top-4">
          {items.length === 0 && !readOnly ? (
            <AiEmptyState
              aiAvailable={!aiUnavailable}
              onGenerate={() => openAi(aiUnavailable ? "bank" : "topic")}
              onAdd={() => setDialog("type")}
              onBank={() => setDialog("bank")}
            />
          ) : (
            <StagePreview item={selected} themeKey={quiz.theme_key} position={selectedIndex + 1} total={items.length} />
          )}
        </section>

        <aside
          aria-label={t("quizBuilder.properties.label")}
          className={cn(
            "min-w-0 rounded-lg border border-line bg-surface p-4 sm:p-5 lg:col-start-2 xl:col-start-3 xl:row-start-1",
            "xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto"
          )}
        >
          {selected ? (
            <ItemProperties
              key={selected.id}
              item={selected}
              issues={issuesById[selected.id] ?? []}
              themeKey={quiz.theme_key}
              limits={capabilities.limits}
              readOnly={readOnly}
              reviewing={reviewingId === selected.id}
              onPatch={(patch) => autosave.scheduleItem(selected.id, patch)}
              onReview={(confirmKey) => void reviewItem(selected, confirmKey)}
              // Deterministic and free: only needs /api/ai to be on (not credits).
              suggestTime={!readOnly && aiCapabilities.data?.enabled === true}
              aiPanel={
                !readOnly && isAiItemType(selected.item_type) && selected.source_kind !== "bank" && aiCapabilities.isSuccess ? (
                  <ItemAiPanel
                    item={selected}
                    quizId={quizId}
                    capabilities={aiCapabilities.data}
                    unavailable={aiUnavailable}
                    jobId={improveJobs[selected.id] ?? null}
                    onJobStarted={(jobId) => setImproveJob(selected.id, jobId)}
                    onClear={() => setImproveJob(selected.id, null)}
                    onApply={applyImprovement}
                  />
                ) : null
              }
            />
          ) : (
            <p className="text-sm text-fg-muted">{t("quizBuilder.properties.empty")}</p>
          )}
        </aside>
      </div>

      <TypePickerDialog open={dialog === "type"} onClose={() => setDialog(null)} types={capabilities.item_types} onPick={(type) => void addItem(type)} disabled={busy} />

      <BankPickerDialog
        open={dialog === "bank"}
        onClose={() => setDialog(null)}
        remaining={Math.max(0, capabilities.limits.max_items - items.length)}
        onAdd={addFromBank}
      />

      {!readOnly ? (
        <AiGenerateDialog
          open={dialog === "ai"}
          onClose={() => setDialog(null)}
          quizId={quizId}
          quizLanguage={quiz.language}
          capacity={capacity}
          itemTypes={aiItemTypes}
          capabilities={aiCapabilities.data}
          unavailable={aiUnavailable}
          initialTab={aiTab}
          jobId={aiJobId}
          onJobChange={setAiJobId}
          applyDrafts={applyDrafts}
          addFromBank={addFromBank}
          onOpenItem={(itemId) => {
            setSelectedId(itemId);
            setDialog(null);
          }}
        />
      ) : null}

      <SettingsDrawer
        open={dialog === "settings"}
        onClose={() => setDialog(null)}
        quiz={quiz}
        themes={capabilities.themes}
        readOnly={readOnly}
        onPatch={autosave.scheduleQuiz}
      />

      <PublishDialog
        open={dialog === "publish"}
        onClose={() => setDialog(null)}
        itemCount={items.length}
        scoredCount={scoredItemCount(quiz)}
        localIssueCount={localIssueCount}
        publish={publish}
        onSelectItem={setSelectedId}
        onPresent={() => setDialog("present")}
      />

      {dialog === "present" ? (
        <StartSessionDialog
          open
          onClose={() => setDialog(null)}
          quiz={server}
          maxParticipants={capabilities.limits.max_participants}
          publish={publish}
          onSelectItem={setSelectedId}
        />
      ) : null}

      {dialog === "challenge" ? (
        <CreateChallengeDialog open onClose={() => setDialog(null)} quiz={server} onSelectItem={setSelectedId} />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("quizBuilder.rail.deleteConfirm.title", { position: deleteTarget ? items.findIndex((item) => item.id === deleteTarget.id) + 1 : 0 })}
        message={t("quizBuilder.rail.deleteConfirm.message")}
        confirmLabel={t("quizBuilder.rail.deleteConfirm.confirm")}
        tone="danger"
        busy={busy && deleteTarget !== null}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function BackLink() {
  const { t } = useI18n();
  return (
    <Link href="/quizzes" className="focus-ring inline-flex items-center gap-1.5 self-start rounded-sm text-[0.8125rem] font-medium text-fg-muted hover:text-fg">
      <ArrowLeftIcon />
      {t("quizBuilder.editor.back")}
    </Link>
  );
}
