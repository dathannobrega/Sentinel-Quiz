"use client";

import { useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { ChallengeIcon } from "@/features/quiz-builder/components/icons";
import { ModerationFindings } from "@/features/quiz-builder/components/moderation-findings";
import {
  ATTEMPTS_MAX,
  ATTEMPTS_MIN,
  DEADLINE_SHORTCUTS,
  FEEDBACK_POLICIES,
  TIME_MODES,
  buildChallengePayload,
  defaultFeedback,
  effectiveFeedback,
  hasErrors,
  initialChallengeForm,
  shortcutDeadline,
  validateChallengeForm,
  type ChallengeForm,
  type ChallengeFormErrors
} from "@/features/quiz-challenge/lib/challenge-form";
import {
  isLicenseRequiresLogin,
  isModerationPending,
  isQuizBlocked,
  type LiveLicenseBlockedItem
} from "@/lib/api/live-authoring";
import { toChallengeOwnerErrorCode } from "@/lib/api/live-challenge";
import { useI18n } from "@/lib/i18n";
import { useCreateChallenge } from "@/lib/query/live-hooks";
import { cn } from "@/lib/utils/cn";
import type { LiveModerationFinding, LiveQuizSummary } from "@/types/api";

interface CreateChallengeDialogProps {
  open: boolean;
  onClose: () => void;
  quiz: Pick<LiveQuizSummary, "id" | "title" | "has_unpublished_changes" | "published_version_no">;
  /** Editor only: jump to an item mentioned by a license block. */
  onSelectItem?: (itemId: string) => void;
  /** Test seam (defaults to Date.now). */
  now?: () => number;
}

/** Radio card used by the time and correction choices (whole card is the hit target, ≥ 44 px). */
function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  disabled,
  title,
  description,
  badge,
  children
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title: string;
  description: string;
  badge?: string;
  children?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
        checked ? "border-primary bg-primary-soft/40" : "border-line hover:border-line-strong"
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 font-medium text-fg">
          {title}
          {badge ? <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-normal text-fg-muted">{badge}</span> : null}
        </span>
        <span className="text-[0.8125rem] text-fg-muted">{description}</span>
        {children}
      </span>
    </label>
  );
}

/**
 * "Criar desafio" (CONTRATO-INCREMENTO-6 §2/§6): a permanent link answered at each person's pace
 * until the deadline. Same server gates as "Apresentar" (license, moderation), mapped to the same
 * friendly messages. On success, the challenge panel opens (link, QR, progress).
 */
export function CreateChallengeDialog({ open, onClose, quiz, onSelectItem, now = Date.now }: CreateChallengeDialogProps) {
  const { t } = useI18n();
  const router = useRouter();
  const create = useCreateChallenge();
  const baseId = useId();
  const [form, setForm] = useState<ChallengeForm>(() => initialChallengeForm(now()));
  const [showErrors, setShowErrors] = useState(false);
  const [blocked, setBlocked] = useState<LiveLicenseBlockedItem[]>([]);
  const [loginHelps, setLoginHelps] = useState(true);
  const [moderation, setModeration] = useState<{ kind: "pending"; findings: LiveModerationFinding[] } | { kind: "blocked" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const published = quiz.published_version_no !== null;
  const busy = create.isPending;
  const errors: ChallengeFormErrors = validateChallengeForm(form, now());
  const visibleErrors = showErrors ? errors : {};
  const feedback = effectiveFeedback(form);
  const suggested = defaultFeedback(form.leaderboard);

  function update(patch: Partial<ChallengeForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function reset() {
    setBlocked([]);
    setModeration(null);
    setError(null);
  }

  async function submit(override?: Partial<ChallengeForm>) {
    const next = { ...form, ...override };
    if (override) {
      setForm(next);
    }
    setShowErrors(true);
    if (hasErrors(validateChallengeForm(next, now())) || !published) {
      return;
    }
    reset();
    try {
      const session = await create.mutateAsync(buildChallengePayload(quiz.id, next));
      router.push(`/quizzes/${encodeURIComponent(quiz.id)}/challenges/${encodeURIComponent(session.id)}`);
    } catch (caught) {
      if (isLicenseRequiresLogin(caught)) {
        setBlocked(caught.items);
        setLoginHelps(caught.code === "license_requires_login");
      } else if (isModerationPending(caught)) {
        setModeration({ kind: "pending", findings: caught.findings });
      } else if (isQuizBlocked(caught)) {
        setModeration({ kind: "blocked" });
      } else {
        setError(t(`quizChallenge.create.errors.${toChallengeOwnerErrorCode(caught)}`));
      }
    }
  }

  const errorText = (key: keyof ChallengeFormErrors) => (visibleErrors[key] ? t(`quizChallenge.create.errors.${visibleErrors[key]}`) : null);

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
      dismissible={!busy}
      title={t("quizChallenge.create.title")}
      description={t("quizChallenge.create.description")}
      className="w-[min(40rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("quizBuilder.create.cancel")}
          </Button>
          <Button busy={busy} busyLabel={t("quizChallenge.create.submitting")} disabled={!published} onClick={() => void submit()}>
            <ChallengeIcon />
            {t("quizChallenge.create.submit")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {!published ? (
          <Alert tone="warning" role="alert" title={t("quizChallenge.create.mustPublishTitle")} message={t("quizChallenge.create.mustPublish")} />
        ) : quiz.has_unpublished_changes ? (
          <Alert tone="neutral" message={t("quizChallenge.create.usesPublished", { version: quiz.published_version_no ?? 0 })} />
        ) : null}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-[0.8125rem] font-medium text-fg">{t("quizChallenge.create.window.legend")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span id={`${baseId}-opens-label`} className="text-[0.8125rem] font-medium text-fg">
                {t("quizChallenge.create.window.opens")}
              </span>
              <div role="radiogroup" aria-labelledby={`${baseId}-opens-label`} className="flex flex-wrap gap-2">
                {(["now", "later"] as const).map((mode) => (
                  <label
                    key={mode}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-focus-visible:outline-2 has-focus-visible:outline-focus",
                      form.opensMode === mode ? "border-primary bg-primary-soft/40" : "border-line hover:border-line-strong"
                    )}
                  >
                    <input
                      type="radio"
                      name={`${baseId}-opens`}
                      checked={form.opensMode === mode}
                      onChange={() => update({ opensMode: mode })}
                      disabled={busy}
                      className="size-4 accent-primary"
                    />
                    {t(`quizChallenge.create.window.${mode}`)}
                  </label>
                ))}
              </div>
              {form.opensMode === "later" ? (
                <Field label={t("quizChallenge.create.window.opensAt")} htmlFor={`${baseId}-opens-at`} error={errorText("opensAt")} hintMode="none">
                  <Input
                    id={`${baseId}-opens-at`}
                    type="datetime-local"
                    value={form.opensAt}
                    disabled={busy}
                    onChange={(event) => update({ opensAt: event.target.value })}
                  />
                </Field>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Field
                label={t("quizChallenge.create.window.closesAt")}
                htmlFor={`${baseId}-closes-at`}
                hint={t("quizChallenge.create.window.closesHint")}
                hintMode="inline"
                error={errorText("closesAt")}
              >
                <Input
                  id={`${baseId}-closes-at`}
                  type="datetime-local"
                  value={form.closesAt}
                  disabled={busy}
                  onChange={(event) => update({ closesAt: event.target.value })}
                />
              </Field>
              <div role="group" aria-label={t("quizChallenge.create.window.shortcuts")} className="flex flex-wrap gap-2">
                {DEADLINE_SHORTCUTS.map((days) => (
                  <Button key={days} type="button" size="sm" variant="secondary" disabled={busy} className="min-h-11" onClick={() => update({ closesAt: shortcutDeadline(form, days, now()) })}>
                    {t(`quizChallenge.create.window.shortcut${days}`)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </fieldset>

        <Field
          label={t("quizChallenge.create.attempts.label")}
          htmlFor={`${baseId}-attempts`}
          hint={t("quizChallenge.create.attempts.hint")}
          hintMode="inline"
          error={errorText("attempts")}
        >
          <Select
            id={`${baseId}-attempts`}
            value={String(form.attempts)}
            disabled={busy}
            onChange={(event) => update({ attempts: Number(event.target.value) })}
            className="max-w-48"
          >
            {Array.from({ length: ATTEMPTS_MAX - ATTEMPTS_MIN + 1 }, (_, index) => ATTEMPTS_MIN + index).map((count) => (
              <option key={count} value={count}>
                {count === 1 ? t("quizChallenge.create.attempts.one") : t("quizChallenge.create.attempts.many", { count })}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[0.8125rem] font-medium text-fg">{t("quizChallenge.create.time.legend")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {TIME_MODES.map((mode) => (
              <ChoiceCard
                key={mode}
                name={`${baseId}-time`}
                value={mode}
                checked={form.timeMode === mode}
                onChange={() => update({ timeMode: mode })}
                disabled={busy}
                title={t(`quizChallenge.create.time.${mode}.name`)}
                description={t(`quizChallenge.create.time.${mode}.description`)}
              />
            ))}
          </div>
          {form.timeMode === "total" ? (
            <div className="motion-safe:animate-[rise-in_200ms_var(--ease-out)_both]">
              <Field
                label={t("quizChallenge.create.time.minutes")}
                htmlFor={`${baseId}-minutes`}
                hint={t("quizChallenge.create.time.minutesHint")}
                hintMode="inline"
                error={errorText("totalMinutes")}
              >
                <Input
                  id={`${baseId}-minutes`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={240}
                  step={1}
                  value={form.totalMinutes}
                  disabled={busy}
                  onChange={(event) => update({ totalMinutes: event.target.value })}
                  className="max-w-32"
                />
              </Field>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizChallenge.create.feedback.legend")}</legend>
          <p className="mb-1 text-[0.8125rem] text-fg-muted">{t("quizChallenge.create.feedback.hint")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {FEEDBACK_POLICIES.map((policy) => (
              <ChoiceCard
                key={policy}
                name={`${baseId}-feedback`}
                value={policy}
                checked={feedback === policy}
                onChange={() => update({ feedback: policy })}
                disabled={busy}
                title={t(`quizChallenge.create.feedback.${policy}.name`)}
                description={t(`quizChallenge.create.feedback.${policy}.description`)}
                badge={policy === suggested ? t("quizChallenge.create.feedback.default") : undefined}
              />
            ))}
          </div>
        </fieldset>

        <div className={cn("flex flex-col gap-2 rounded-md border p-3 transition-colors", form.leaderboard ? "border-primary/40 bg-primary-soft/30" : "border-line")}>
          <Checkbox
            id={`${baseId}-leaderboard`}
            checked={form.leaderboard}
            onChange={(event) => update({ leaderboard: event.target.checked })}
            label={t("quizChallenge.create.leaderboard.label")}
            description={t("quizChallenge.create.leaderboard.description")}
            disabled={busy}
          />
          {form.leaderboard ? (
            <div role="note" className="flex flex-col gap-2 rounded-md bg-warning-soft px-3 py-2 text-[0.8125rem] text-fg motion-safe:animate-[rise-in_200ms_var(--ease-out)_both]">
              <p>
                <span className="font-semibold">{t("quizChallenge.create.leaderboard.hintTitle")}</span> {t("quizChallenge.create.leaderboard.hint")}
              </p>
              {!form.requireLogin ? (
                <div>
                  <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => update({ requireLogin: true })}>
                    {t("quizChallenge.create.leaderboard.requireLogin")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid gap-1 sm:grid-cols-2">
          <Checkbox
            id={`${baseId}-shuffle`}
            checked={form.shuffleItems}
            onChange={(event) => update({ shuffleItems: event.target.checked })}
            label={t("quizChallenge.create.shuffle.label")}
            description={t("quizChallenge.create.shuffle.description")}
            disabled={busy}
          />
          <Checkbox
            id={`${baseId}-login`}
            checked={form.requireLogin}
            onChange={(event) => update({ requireLogin: event.target.checked })}
            label={t("quizChallenge.create.requireLogin.label")}
            description={t("quizChallenge.create.requireLogin.description")}
            disabled={busy}
          />
        </div>

        {blocked.length ? (
          <div role="alert" className="flex flex-col gap-3 rounded-md border border-warning/30 bg-warning-soft p-4 text-sm">
            <p className="font-semibold text-fg">{t("quizBuilder.present.licenseBlocked.title")}</p>
            <p className="text-fg-muted">
              {loginHelps ? t("quizBuilder.present.licenseBlocked.message") : t("quizBuilder.present.licenseBlocked.blockedMessage")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {blocked.map((item, index) => (
                <li key={`${item.item_id ?? "item"}-${index}`} className="flex flex-wrap items-baseline gap-2">
                  {item.item_id && onSelectItem ? (
                    <button
                      type="button"
                      className="focus-ring rounded-sm font-medium text-primary underline underline-offset-2"
                      onClick={() => {
                        onSelectItem(item.item_id as string);
                        onClose();
                      }}
                    >
                      {t("quizBuilder.present.licenseBlocked.item", { position: (item.position ?? index) + 1 })}
                    </button>
                  ) : (
                    <span className="font-medium text-fg">{t("quizBuilder.present.licenseBlocked.item", { position: (item.position ?? index) + 1 })}</span>
                  )}
                  {item.prompt ? <span className="line-clamp-1 text-fg-muted">{item.prompt}</span> : null}
                </li>
              ))}
            </ul>
            {loginHelps ? (
              <div>
                <Button size="sm" busy={busy} onClick={() => void submit({ requireLogin: true })}>
                  {t("quizChallenge.create.requireLoginAndCreate")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {moderation?.kind === "pending" ? (
          <ModerationFindings
            title={t("quizBuilder.moderation.pendingTitle")}
            message={t("quizBuilder.moderation.pendingText")}
            findings={moderation.findings}
            action={
              <Button size="sm" busy={busy} onClick={() => void submit({ requireLogin: true })}>
                {t("quizBuilder.moderation.pendingLoginOnly")}
              </Button>
            }
          />
        ) : null}

        {moderation?.kind === "blocked" ? (
          <Alert tone="danger" role="alert" title={t("quizBuilder.moderation.blockedTitle")} message={t("quizBuilder.moderation.blockedText")} />
        ) : null}

        {error ? <Alert tone="danger" role="alert" message={error} /> : null}
        {/* Enter in a field submits; the visible button lives in the dialog footer. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
