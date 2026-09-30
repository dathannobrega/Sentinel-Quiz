"use client";

import { Dialog } from "@/components/ui/dialog";
import type { WordCloudResults } from "@/features/quiz-live/lib/protocol";
import { sortWords } from "@/features/quiz-live/lib/word-cloud";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

const TONES = {
  live: {
    muted: "text-lq-fg-muted",
    text: "text-lq-fg",
    row: "border-lq-line",
    button: "border border-lq-line bg-lq-surface text-lq-fg hover:bg-lq-surface-2"
  },
  app: {
    muted: "text-fg-muted",
    text: "text-fg",
    row: "border-line",
    button: "border border-line bg-surface text-fg hover:bg-surface-muted"
  }
} as const;

/**
 * Word cloud moderation for the host (contract §7): every visible word with "Ocultar" and the words
 * the server reports as hidden (`hidden_words`, normalized keys shown as-is) with "Mostrar", so a
 * word hidden from any device can be shown again. Uses the normalized `key` in `host.hide_word`,
 * so every spelling of the word goes at once. `filtered` counts words kept off the screens (filter
 * terms and hidden ones).
 */
export function WordModerationPanel({
  cloud,
  hidden,
  onToggle,
  disabled = false,
  tone = "live"
}: {
  cloud: WordCloudResults | null;
  /** Normalized keys hidden by the host (server state). */
  hidden: readonly string[];
  onToggle: (key: string, hidden: boolean) => void;
  disabled?: boolean;
  tone?: keyof typeof TONES;
}) {
  const { t, locale } = useI18n();
  const styles = TONES[tone];
  const hiddenKeys = new Set(hidden);
  const words = sortWords(cloud?.words ?? []).filter((word) => !hiddenKeys.has(word.key));
  const format = new Intl.NumberFormat(locale);
  const button = cn(
    "focus-ring inline-flex min-h-9 shrink-0 items-center rounded-md px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60",
    styles.button
  );
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <p className={cn("text-sm", styles.muted)}>
        {cloud
          ? t("quizPresent.words.summary", { distinct: format.format(cloud.distinct), filtered: format.format(cloud.filtered) })
          : t("quizPresent.words.none")}
      </p>
      {words.length ? (
        <ul className={cn("flex max-h-80 flex-col divide-y overflow-y-auto", styles.row)} aria-label={t("quizPresent.words.visible")}>
          {words.map((word) => (
            <li key={word.key} className={cn("flex items-center gap-3 py-1.5", styles.row)}>
              <span className={cn("min-w-0 flex-1 truncate font-semibold", styles.text)}>{word.text}</span>
              <span className={cn("font-mono text-xs tabular-nums", styles.muted)}>×{format.format(word.n)}</span>
              <button
                type="button"
                className={button}
                disabled={disabled}
                aria-label={t("quizPresent.words.hideLabel", { word: word.text })}
                onClick={() => onToggle(word.key, true)}
              >
                {t("quizPresent.words.hide")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hidden.length ? (
        <div className="flex flex-col gap-1.5">
          <p className={cn("text-xs font-bold tracking-[0.12em] uppercase", styles.muted)}>{t("quizPresent.words.hiddenTitle")}</p>
          <ul className="flex flex-wrap gap-2">
            {hidden.map((key) => (
              <li key={key} className={cn("flex items-center gap-2 rounded-full border border-dashed py-0.5 pr-0.5 pl-3 text-sm", styles.row, styles.text)}>
                <span className="line-through decoration-2">{key}</span>
                <button
                  type="button"
                  className={cn(button, "min-h-8 rounded-full")}
                  disabled={disabled}
                  aria-label={t("quizPresent.words.showLabel", { word: key })}
                  onClick={() => onToggle(key, false)}
                >
                  {t("quizPresent.words.show")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Same panel in a side dialog for the stage view (opened from the control bar). */
export function WordModerationDialog({
  open,
  onClose,
  ...props
}: {
  open: boolean;
  onClose: () => void;
  cloud: WordCloudResults | null;
  hidden: readonly string[];
  onToggle: (key: string, hidden: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} placement="right" title={t("quizPresent.words.title")} description={t("quizPresent.words.description")} showCloseButton>
      <WordModerationPanel {...props} tone="app" />
    </Dialog>
  );
}
