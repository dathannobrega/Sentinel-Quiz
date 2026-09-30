"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { ThemePicker } from "@/features/quiz-builder/components/theme-picker";
import { CHAR_LIMITS, charLength } from "@/features/quiz-builder/lib/limits";
import type { QuizPatch } from "@/features/quiz-builder/hooks/use-editor-autosave";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveQuizDetail, LiveQuizSettings, LiveScoring, LiveThemeKey } from "@/types/api";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  quiz: LiveQuizDetail;
  themes: LiveThemeKey[];
  readOnly: boolean;
  onPatch: (patch: QuizPatch) => void;
}

const SCORING: LiveScoring[] = ["speed", "fixed", "none"];

export function SettingsDrawer({ open, onClose, quiz, themes, readOnly, onPatch }: SettingsDrawerProps) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      placement="right"
      title={t("quizBuilder.settings.title")}
      description={t("quizBuilder.settings.description")}
      className="w-[min(30rem,100vw)]"
      footer={<Button onClick={onClose}>{t("quizBuilder.settings.done")}</Button>}
    >
      {open ? <SettingsForm quiz={quiz} themes={themes} readOnly={readOnly} onPatch={onPatch} /> : null}
    </Dialog>
  );
}

function SettingsForm({ quiz, themes, readOnly, onPatch }: Omit<SettingsDrawerProps, "open" | "onClose">) {
  const { t } = useI18n();
  const baseId = useId();
  const settings = quiz.settings;
  const setSetting = <K extends keyof LiveQuizSettings>(key: K, value: LiveQuizSettings[K]) =>
    onPatch({ settings: { [key]: value } as Partial<LiveQuizSettings> });

  const titleLength = charLength(quiz.title);
  const titleError = !quiz.title.trim()
    ? t("quizBuilder.create.titleRequired")
    : titleLength > CHAR_LIMITS.title.max
      ? t("quizBuilder.properties.counterBlock", { max: CHAR_LIMITS.title.max })
      : null;
  const descriptionError =
    charLength(quiz.description) > CHAR_LIMITS.description.max
      ? t("quizBuilder.properties.counterBlock", { max: CHAR_LIMITS.description.max })
      : null;

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-4">
        <h3 className="text-[0.8125rem] font-semibold tracking-[0.06em] text-fg-muted uppercase">{t("quizBuilder.settings.general")}</h3>
        <Field label={t("quizBuilder.settings.titleLabel")} htmlFor={`${baseId}-title`} error={titleError} hintMode="none">
          <Input id={`${baseId}-title`} value={quiz.title} readOnly={readOnly} onChange={(event) => onPatch({ title: event.target.value })} />
        </Field>
        <Field label={t("quizBuilder.settings.descriptionLabel")} htmlFor={`${baseId}-description`} error={descriptionError} hintMode="none">
          <Textarea
            id={`${baseId}-description`}
            rows={2}
            className="min-h-16"
            value={quiz.description ?? ""}
            readOnly={readOnly}
            onChange={(event) => onPatch({ description: event.target.value })}
          />
        </Field>
        <Field label={t("quizBuilder.settings.language")} htmlFor={`${baseId}-language`} hintMode="none">
          <Select id={`${baseId}-language`} value={quiz.language} disabled={readOnly} onChange={(event) => onPatch({ language: event.target.value })}>
            <option value="pt-BR">{t("quizBuilder.settings.languages.pt-BR")}</option>
            <option value="en">{t("quizBuilder.settings.languages.en")}</option>
          </Select>
        </Field>
        <ThemePicker
          label={t("quizBuilder.themes.label")}
          value={quiz.theme_key}
          themes={themes}
          disabled={readOnly}
          columns={2}
          onChange={(theme) => onPatch({ theme_key: theme })}
        />
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-3 text-[0.8125rem] font-semibold tracking-[0.06em] text-fg-muted uppercase">{t("quizBuilder.settings.scoring")}</legend>
        {SCORING.map((value) => (
          <label
            key={value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
              settings.scoring === value ? "border-primary bg-primary-soft/40" : "border-line hover:border-line-strong"
            )}
          >
            <input
              type="radio"
              name={`${baseId}-scoring`}
              checked={settings.scoring === value}
              disabled={readOnly}
              onChange={() => setSetting("scoring", value)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-fg">{t(`quizBuilder.settings.scoringOptions.${value}.name`)}</span>
              <span className="text-[0.8125rem] text-fg-muted">{t(`quizBuilder.settings.scoringOptions.${value}.description`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <section className="flex flex-col gap-4">
        <h3 className="text-[0.8125rem] font-semibold tracking-[0.06em] text-fg-muted uppercase">{t("quizBuilder.settings.gameplay")}</h3>
        <NumberSetting
          id={`${baseId}-reading`}
          label={t("quizBuilder.settings.readingPhase")}
          hint={t("quizBuilder.settings.readingPhaseHint")}
          value={settings.reading_phase_s}
          min={0}
          max={10}
          readOnly={readOnly}
          onValid={(value) => setSetting("reading_phase_s", value)}
        />
        <NumberSetting
          id={`${baseId}-grace`}
          label={t("quizBuilder.settings.grace")}
          hint={t("quizBuilder.settings.graceHint")}
          value={settings.grace_ms}
          min={0}
          max={1500}
          step={50}
          readOnly={readOnly}
          onValid={(value) => setSetting("grace_ms", value)}
        />
        <NumberSetting
          id={`${baseId}-leaderboard`}
          label={t("quizBuilder.settings.leaderboardEvery")}
          hint={t("quizBuilder.settings.leaderboardEveryHint")}
          value={settings.leaderboard_every}
          min={0}
          max={20}
          readOnly={readOnly}
          onValid={(value) => setSetting("leaderboard_every", value)}
        />
        <Checkbox
          id={`${baseId}-streak`}
          checked={settings.streak_bonus}
          disabled={readOnly}
          onChange={(event) => setSetting("streak_bonus", event.target.checked)}
          label={t("quizBuilder.settings.streak")}
          description={t("quizBuilder.settings.streakHint")}
        />
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="mb-2 text-[0.8125rem] font-semibold tracking-[0.06em] text-fg-muted uppercase">{t("quizBuilder.settings.display")}</h3>
        <Checkbox
          id={`${baseId}-dist`}
          checked={settings.show_live_distribution}
          disabled={readOnly}
          onChange={(event) => setSetting("show_live_distribution", event.target.checked)}
          label={t("quizBuilder.settings.liveDistribution")}
        />
        <Checkbox
          id={`${baseId}-correct`}
          checked={settings.show_correct_on_device}
          disabled={readOnly}
          onChange={(event) => setSetting("show_correct_on_device", event.target.checked)}
          label={t("quizBuilder.settings.showCorrect")}
        />
        <Checkbox
          id={`${baseId}-explanation`}
          checked={settings.show_explanation}
          disabled={readOnly}
          onChange={(event) => setSetting("show_explanation", event.target.checked)}
          label={t("quizBuilder.settings.showExplanation")}
        />
        <Checkbox
          id={`${baseId}-music`}
          checked={settings.music}
          disabled={readOnly}
          onChange={(event) => setSetting("music", event.target.checked)}
          label={t("quizBuilder.settings.music")}
        />
      </section>
    </div>
  );
}

function NumberSetting({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  readOnly,
  onValid
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  readOnly: boolean;
  onValid: (value: number) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const parsed = Number(shown);
  const invalid = !shown.trim() || !Number.isInteger(parsed) || parsed < min || parsed > max;
  return (
    <Field label={label} htmlFor={id} hint={hint} hintMode="inline" error={invalid ? t("quizBuilder.settings.rangeError", { min, max }) : null}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        className="w-32"
        min={min}
        max={max}
        step={step}
        value={shown}
        readOnly={readOnly}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const number = Number(next);
          if (next.trim() && Number.isInteger(number) && number >= min && number <= max) {
            onValid(number);
          }
        }}
        onBlur={() => {
          if (!invalid) setDraft(null);
        }}
      />
    </Field>
  );
}
