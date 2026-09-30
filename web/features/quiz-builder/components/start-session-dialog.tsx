"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { PresentIcon } from "@/features/quiz-builder/components/icons";
import { IssueList } from "@/features/quiz-builder/components/issue-list";
import {
  isLicenseRequiresLogin,
  isQuizInvalid,
  isQuizNotPublished,
  type LiveLicenseBlockedItem
} from "@/lib/api/live-authoring";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useCreateLiveSession } from "@/lib/query/live-hooks";
import { cn } from "@/lib/utils/cn";
import type { LiveAudience, LiveIssue, LivePreset, LivePublishResult, LiveQuizSummary } from "@/types/api";

interface StartSessionDialogProps {
  open: boolean;
  onClose: () => void;
  quiz: Pick<LiveQuizSummary, "id" | "title" | "has_unpublished_changes" | "published_version_no">;
  maxParticipants: number;
  /** Publishes the current draft (the editor passes its serialized mutator). */
  publish: () => Promise<LivePublishResult>;
  /** Editor only: jump to an item mentioned by a validation issue or license block. */
  onSelectItem?: (itemId: string) => void;
}

const PRESETS: LivePreset[] = ["turma", "evento"];
const AUDIENCES: LiveAudience[] = ["adulto", "misto", "infantojuvenil"];

export function StartSessionDialog({ open, onClose, quiz, maxParticipants, publish, onSelectItem }: StartSessionDialogProps) {
  const { t } = useI18n();
  const router = useRouter();
  const createSession = useCreateLiveSession();
  const baseId = useId();
  const [allowGuests, setAllowGuests] = useState(true);
  const [preset, setPreset] = useState<LivePreset>("turma");
  const [audience, setAudience] = useState<LiveAudience>("adulto");
  const [maxInput, setMaxInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [issues, setIssues] = useState<LiveIssue[]>([]);
  const [blocked, setBlocked] = useState<LiveLicenseBlockedItem[]>([]);
  const [loginHelps, setLoginHelps] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishedNow, setPublishedNow] = useState<number | null>(null);

  const neverPublished = quiz.published_version_no === null && publishedNow === null;
  const needsPublish = (quiz.has_unpublished_changes || neverPublished) && publishedNow === null;
  const busy = publishing || createSession.isPending;
  const parsedMax = maxInput.trim() ? Number(maxInput) : null;
  const maxError =
    parsedMax !== null && (!Number.isInteger(parsedMax) || parsedMax < 1 || parsedMax > maxParticipants)
      ? t("quizBuilder.present.maxParticipantsHint", { max: maxParticipants })
      : null;

  function reset() {
    setIssues([]);
    setBlocked([]);
    setError(null);
  }

  async function openRoom(guests: boolean) {
    const session = await createSession.mutateAsync({
      quiz_id: quiz.id,
      allow_guests: guests,
      preset,
      audience,
      ...(parsedMax !== null ? { max_participants: parsedMax } : {})
    });
    router.push(`/present/${encodeURIComponent(session.id)}`);
  }

  async function start(options: { publishFirst: boolean; guests: boolean }) {
    if (maxError) {
      return;
    }
    reset();
    try {
      if (options.publishFirst) {
        setPublishing(true);
        const result = await publish();
        setPublishedNow(result.version_no);
        setPublishing(false);
      }
      await openRoom(options.guests);
    } catch (caught) {
      setPublishing(false);
      if (isQuizInvalid(caught)) {
        setIssues(caught.issues);
      } else if (isLicenseRequiresLogin(caught)) {
        setBlocked(caught.items);
        setLoginHelps(caught.code === "license_requires_login");
      } else if (isQuizNotPublished(caught)) {
        setError(t("quizBuilder.present.notPublished"));
      } else {
        setError(readErrorMessage(caught, t("quizBuilder.present.error")));
      }
    }
  }

  const publishedVersion = publishedNow ?? quiz.published_version_no;

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
      title={t("quizBuilder.present.title")}
      description={t("quizBuilder.present.description")}
      className="w-[min(36rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("quizBuilder.create.cancel")}
          </Button>
          {needsPublish && !neverPublished && publishedVersion !== null ? (
            <Button variant="secondary" disabled={busy || Boolean(maxError)} onClick={() => void start({ publishFirst: false, guests: allowGuests })}>
              {t("quizBuilder.present.presentPublished", { version: publishedVersion })}
            </Button>
          ) : null}
          <Button
            busy={busy}
            disabled={Boolean(maxError)}
            onClick={() => void start({ publishFirst: needsPublish, guests: allowGuests })}
          >
            <PresentIcon />
            {needsPublish ? t("quizBuilder.present.publishAndPresent") : t("quizBuilder.present.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {needsPublish ? (
          <Alert
            tone="warning"
            title={t("quizBuilder.present.mustPublish.title")}
            message={neverPublished ? t("quizBuilder.present.mustPublish.never") : t("quizBuilder.present.mustPublish.message")}
          />
        ) : null}

        <Checkbox
          id={`${baseId}-guests`}
          checked={allowGuests}
          onChange={(event) => setAllowGuests(event.target.checked)}
          label={t("quizBuilder.present.guests")}
          description={t("quizBuilder.present.guestsHint")}
          disabled={busy}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[0.8125rem] font-medium text-fg">{t("quizBuilder.present.preset")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((value) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
                  preset === value ? "border-primary bg-primary-soft/40" : "border-line hover:border-line-strong"
                )}
              >
                <input
                  type="radio"
                  name={`${baseId}-preset`}
                  value={value}
                  checked={preset === value}
                  onChange={() => setPreset(value)}
                  disabled={busy}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium text-fg">{t(`quizBuilder.present.presets.${value}.name`)}</span>
                  <span className="text-[0.8125rem] text-fg-muted">{t(`quizBuilder.present.presets.${value}.description`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("quizBuilder.present.audience")} htmlFor={`${baseId}-audience`} hintMode="none">
            <Select
              id={`${baseId}-audience`}
              value={audience}
              disabled={busy}
              onChange={(event) => setAudience(event.target.value as LiveAudience)}
            >
              {AUDIENCES.map((value) => (
                <option key={value} value={value}>
                  {t(`quizBuilder.present.audiences.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t("quizBuilder.present.maxParticipants")}
            htmlFor={`${baseId}-max`}
            hint={t("quizBuilder.present.maxParticipantsHint", { max: maxParticipants })}
            hintMode="inline"
            error={maxError}
          >
            <Input
              id={`${baseId}-max`}
              type="number"
              inputMode="numeric"
              min={1}
              max={maxParticipants}
              placeholder={String(maxParticipants)}
              value={maxInput}
              disabled={busy}
              onChange={(event) => setMaxInput(event.target.value)}
            />
          </Field>
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
                    <span className="font-medium text-fg">
                      {t("quizBuilder.present.licenseBlocked.item", { position: (item.position ?? index) + 1 })}
                    </span>
                  )}
                  {item.prompt ? <span className="line-clamp-1 text-fg-muted">{item.prompt}</span> : null}
                  {item.license_scope ? (
                    <span className="text-xs text-fg-muted">({t(`quizBuilder.license.${item.license_scope}`)})</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div hidden={!loginHelps}>
              <Button
                size="sm"
                busy={busy}
                onClick={() => {
                  setAllowGuests(false);
                  void start({ publishFirst: false, guests: false });
                }}
              >
                {t("quizBuilder.present.licenseBlocked.requireLogin")}
              </Button>
            </div>
          </div>
        ) : null}

        {issues.length ? (
          <div className="flex flex-col gap-2">
            <IssueList
              issues={issues}
              tone="danger"
              title={t("quizBuilder.publish.issuesTitle")}
              description={onSelectItem ? t("quizBuilder.publish.issuesMessage") : undefined}
              onSelectItem={
                onSelectItem
                  ? (itemId) => {
                      onSelectItem(itemId);
                      onClose();
                    }
                  : undefined
              }
            />
            {!onSelectItem ? (
              <Link href={`/quizzes/${encodeURIComponent(quiz.id)}/edit`} className={cn(buttonClassName("secondary", "sm"), "self-start")}>
                {t("quizBuilder.library.card.edit")}
              </Link>
            ) : null}
          </div>
        ) : null}

        {error ? <Alert tone="danger" role="alert" message={error} /> : null}
      </div>
    </Dialog>
  );
}
