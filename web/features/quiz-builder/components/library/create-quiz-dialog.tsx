"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { ThemePicker } from "@/features/quiz-builder/components/theme-picker";
import { CHAR_LIMITS, charLength } from "@/features/quiz-builder/lib/limits";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useCreateLiveQuiz } from "@/lib/query/live-hooks";
import type { LiveThemeKey } from "@/types/api";

interface CreateQuizDialogProps {
  open: boolean;
  onClose: () => void;
  themes: LiveThemeKey[];
}

export function CreateQuizDialog({ open, onClose, themes }: CreateQuizDialogProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const formId = useId();
  const createQuiz = useCreateLiveQuiz();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [theme, setTheme] = useState<LiveThemeKey>("sentinel");
  const [touched, setTouched] = useState(false);

  const trimmed = title.trim();
  const titleError = touched && !trimmed ? t("quizBuilder.create.titleRequired") : null;
  const titleTooLong = charLength(title) > CHAR_LIMITS.title.max;
  const descriptionTooLong = charLength(description) > CHAR_LIMITS.description.max;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!trimmed || titleTooLong || descriptionTooLong) {
      return;
    }
    const quiz = await createQuiz
      .mutateAsync({
        title: trimmed,
        description: description.trim() || null,
        language: locale === "pt-BR" ? "pt-BR" : "en",
        theme_key: theme
      })
      .catch(() => null);
    if (quiz) {
      router.push(`/quizzes/${encodeURIComponent(quiz.id)}/edit`);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!createQuiz.isPending) {
          onClose();
        }
      }}
      dismissible={!createQuiz.isPending}
      title={t("quizBuilder.create.title")}
      description={t("quizBuilder.create.description")}
      className="w-[min(40rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={createQuiz.isPending}>
            {t("quizBuilder.create.cancel")}
          </Button>
          <Button type="submit" form={formId} busy={createQuiz.isPending}>
            {t("quizBuilder.create.submit")}
          </Button>
        </>
      }
    >
      <form id={formId} className="flex flex-col gap-5" onSubmit={(event) => void onSubmit(event)} noValidate>
        <Field
          label={t("quizBuilder.create.titleLabel")}
          htmlFor={`${formId}-title`}
          error={titleError ?? (titleTooLong ? t("quizBuilder.properties.counterBlock", { max: CHAR_LIMITS.title.max }) : null)}
          hintMode="none"
        >
          <Input
            id={`${formId}-title`}
            value={title}
            autoFocus
            required
            placeholder={t("quizBuilder.create.titlePlaceholder")}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
        <Field
          label={t("quizBuilder.create.descriptionLabel")}
          htmlFor={`${formId}-description`}
          error={descriptionTooLong ? t("quizBuilder.properties.counterBlock", { max: CHAR_LIMITS.description.max }) : null}
          hintMode="none"
        >
          <Textarea
            id={`${formId}-description`}
            value={description}
            rows={2}
            className="min-h-16"
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <ThemePicker label={t("quizBuilder.themes.label")} value={theme} onChange={setTheme} themes={themes} />
        {createQuiz.isError ? (
          <Alert tone="danger" role="alert" message={readErrorMessage(createQuiz.error, t("quizBuilder.library.actionError"))} />
        ) : null}
      </form>
    </Dialog>
  );
}
