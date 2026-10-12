"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { AlertIcon, CircleCheckIcon, CircleXIcon, GaugeIcon, PlusSquareIcon, RepeatIcon, StrikeIcon, WaveIcon } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { formatSpeed, scoreToPercent } from "@/features/reading/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { ReadingAssessedWord, ReadingAssessment, ReadingAttemptSummary, ReadingTip, ReadingWordStatus } from "@/types/api";

export interface AssessmentResultProps {
  assessment: ReadingAssessment;
  /** Plays the whole model (TTS) audio of the block. */
  onListenModel?: () => void;
  /** Plays the model audio of one word. */
  onPlayWord?: (word: ReadingAssessedWord) => void;
  onTryAgain?: () => void;
  modelBusy?: boolean;
  /** Recent attempts for this block (most recent first). */
  attempts?: ReadingAttemptSummary[];
  isNewBest?: boolean;
}

type IconComponent = typeof CircleCheckIcon;

const STATUS_ICON: Record<ReadingWordStatus, IconComponent> = {
  ok: CircleCheckIcon,
  weak: AlertIcon,
  mispronounced: CircleXIcon,
  missed: StrikeIcon
};

const STATUS_LABEL_KEY: Record<ReadingWordStatus, string> = {
  ok: "reading.result.statusOk",
  weak: "reading.result.statusWeak",
  mispronounced: "reading.result.statusMispronounced",
  missed: "reading.result.statusMissed"
};

/** Visual treatment per status: never color alone (underline style, strikethrough, icon in legend). */
const STATUS_CLASS: Record<ReadingWordStatus, string> = {
  ok: "",
  weak: "underline decoration-warning decoration-dotted decoration-2 underline-offset-4",
  mispronounced: "text-danger underline decoration-danger decoration-2 underline-offset-4",
  missed: "text-fg-muted line-through decoration-fg-muted"
};

function wordTitle(word: ReadingAssessedWord, t: (key: string, values?: Record<string, string | number>) => string): string {
  const parts = [t(STATUS_LABEL_KEY[word.status])];
  if (word.heard && word.status !== "ok") {
    parts.push(t("reading.result.heard", { heard: word.heard }));
  }
  if (word.expected_ipa) {
    parts.push(t("reading.result.expectedIpa", { ipa: `/${word.expected_ipa}/` }));
  }
  if (word.heard_ipa) {
    parts.push(t("reading.result.heardIpa", { ipa: `/${word.heard_ipa}/` }));
  }
  return parts.join(" · ");
}

function Legend() {
  const { t } = useI18n();
  const items: Array<{ status: ReadingWordStatus | "extra"; icon: IconComponent; sample: string }> = [
    { status: "ok", icon: CircleCheckIcon, sample: "" },
    { status: "weak", icon: AlertIcon, sample: STATUS_CLASS.weak },
    { status: "mispronounced", icon: CircleXIcon, sample: STATUS_CLASS.mispronounced },
    { status: "missed", icon: StrikeIcon, sample: STATUS_CLASS.missed },
    { status: "extra", icon: PlusSquareIcon, sample: "rounded-sm bg-surface-muted px-1 text-fg-muted" }
  ];
  return (
    <ul aria-label={t("reading.result.legend")} className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted">
      {items.map(({ status, icon: StatusIcon, sample }) => (
        <li key={status} className="inline-flex items-center gap-1.5">
          <StatusIcon size={14} className={cn(status === "mispronounced" && "text-danger", status === "weak" && "text-warning", status === "ok" && "text-success")} />
          <span className={cn("font-serif text-sm", sample)}>{status === "extra" ? t("reading.result.statusExtra") : t(STATUS_LABEL_KEY[status])}</span>
        </li>
      ))}
    </ul>
  );
}

function tipText(tip: ReadingTip, t: (key: string, values?: Record<string, string | number>) => string, target: [number, number]): string {
  const key = `reading.result.tips.${tip.code}`;
  const values = {
    expected: tip.expected ? `/${tip.expected}/` : "",
    heard: tip.heard ? `/${tip.heard}/` : "",
    examples: (tip.examples ?? []).join(", "),
    min: target[0],
    max: target[1],
    code: tip.code
  };
  const text = t(key, values);
  return text === key ? t("reading.result.tips.generic", values) : text;
}

/**
 * Shadowing result: the block re-rendered with each word marked by status, legend, four scores,
 * pace metrics, tips and the block's recent attempts.
 */
export function AssessmentResult({ assessment, onListenModel, onPlayWord, onTryAgain, modelBusy = false, attempts = [], isNewBest = false }: AssessmentResultProps) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<number | null>(null);

  const extrasAfter = new Map<number, string[]>();
  for (const extra of assessment.extras) {
    const list = extrasAfter.get(extra.after_index) ?? [];
    list.push(extra.text);
    extrasAfter.set(extra.after_index, list);
  }

  const renderExtras = (afterIndex: number): ReactNode => {
    const list = extrasAfter.get(afterIndex);
    if (!list) {
      return null;
    }
    return list.map((text, i) => (
      <span key={`extra-${afterIndex}-${i}`} className="mx-0.5 rounded-sm bg-surface-muted px-1 text-sm text-fg-muted" title={t("reading.result.statusExtra")}>
        +{text}
      </span>
    ));
  };

  // Rebuild the paragraph from the reference text, so punctuation and spacing are preserved.
  const nodes: ReactNode[] = [renderExtras(-1)];
  let cursor = 0;
  const sortedWords = [...assessment.words].sort((a, b) => a.char_start - b.char_start);
  sortedWords.forEach((word) => {
    if (word.char_start > cursor) {
      nodes.push(assessment.text.slice(cursor, word.char_start));
    }
    const surface = assessment.text.slice(word.char_start, word.char_end) || word.text;
    const WordIcon = STATUS_ICON[word.status];
    if (word.status === "ok") {
      nodes.push(<span key={`w-${word.index}`}>{surface}</span>);
    } else {
      nodes.push(
        <button
          key={`w-${word.index}`}
          type="button"
          title={wordTitle(word, t)}
          aria-pressed={selected === word.index}
          onClick={() => setSelected((previous) => (previous === word.index ? null : word.index))}
          className={cn("focus-ring inline rounded-sm px-0.5 text-left font-serif", STATUS_CLASS[word.status], selected === word.index && "bg-primary-soft")}
        >
          <WordIcon size={11} className="mr-0.5 inline -translate-y-px" />
          {surface}
          {word.status === "mispronounced" && word.heard ? (
            <span className="ml-1 font-sans text-[0.6875rem] text-danger">({t("reading.result.heard", { heard: word.heard })})</span>
          ) : null}
        </button>
      );
    }
    nodes.push(renderExtras(word.index));
    cursor = Math.max(cursor, word.char_end);
  });
  if (cursor < assessment.text.length) {
    nodes.push(assessment.text.slice(cursor));
  }

  const selectedWord = selected === null ? null : (assessment.words.find((word) => word.index === selected) ?? null);
  const scores: Array<{ key: keyof ReadingAssessment["scores"]; label: string }> = [
    { key: "overall", label: t("reading.result.scores.overall") },
    { key: "accuracy", label: t("reading.result.scores.accuracy") },
    { key: "completeness", label: t("reading.result.scores.completeness") },
    { key: "fluency", label: t("reading.result.scores.fluency") }
  ];
  const metrics = assessment.metrics;
  const bestPercent = assessment.best_overall === null ? null : scoreToPercent(assessment.best_overall);

  return (
    <section aria-label={t("reading.result.title")} className="flex flex-col gap-5">
      {isNewBest ? (
        <p role="status" className="inline-flex items-center gap-2 text-sm font-medium text-success">
          <CircleCheckIcon />
          {t("reading.result.newBest")}
        </p>
      ) : null}

      <p className="font-serif text-[1.0625rem] leading-[1.9] text-fg">{nodes}</p>

      {selectedWord ? (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line bg-surface-muted px-3 py-2 text-sm">
          <span className="sr-only">{t("reading.result.wordDetails")}</span>
          <span className="font-serif font-semibold text-fg">{selectedWord.text}</span>
          <span className="text-fg-muted">{t(STATUS_LABEL_KEY[selectedWord.status])}</span>
          {selectedWord.heard && selectedWord.status !== "ok" ? <span className="text-fg-muted">{t("reading.result.heard", { heard: selectedWord.heard })}</span> : null}
          {selectedWord.expected_ipa ? <span className="nums text-fg-muted">{t("reading.result.expectedIpa", { ipa: `/${selectedWord.expected_ipa}/` })}</span> : null}
          {selectedWord.heard_ipa ? <span className="nums text-fg-muted">{t("reading.result.heardIpa", { ipa: `/${selectedWord.heard_ipa}/` })}</span> : null}
          {onPlayWord ? (
            <Button variant="ghost" size="sm" onClick={() => onPlayWord(selectedWord)} aria-label={t("reading.result.playWord", { word: selectedWord.text })}>
              <WaveIcon />
              {t("reading.shadow.listenModel")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Legend />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        {scores.map(({ key, label }) => {
          const percent = scoreToPercent(assessment.scores[key]);
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[0.8125rem] text-fg-muted">{label}</dt>
                <dd className={cn("nums font-semibold tracking-tight text-fg", key === "overall" ? "text-2xl" : "text-lg")}>{percent}%</dd>
              </div>
              <Meter kind="score" value={percent} label={label} />
            </div>
          );
        })}
      </dl>

      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-muted">
        {metrics.wpm !== null ? (
          <li className="inline-flex items-center gap-1.5">
            <GaugeIcon size={14} />
            <span className="nums">{t("reading.result.wpm", { wpm: Math.round(metrics.wpm) })}</span>
            <span className="text-fg-subtle">({t("reading.result.wpmTarget", { min: metrics.target_wpm[0], max: metrics.target_wpm[1] })})</span>
          </li>
        ) : null}
        <li className="nums">{t("reading.result.pauses", { count: metrics.long_pauses })}</li>
        {metrics.extra > 0 ? <li className="nums">{t("reading.result.extras", { count: metrics.extra })}</li> : null}
      </ul>

      {assessment.tips.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[0.8125rem] font-semibold text-fg">{t("reading.result.tipsTitle")}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg">
            {assessment.tips.map((tip, index) => (
              <li key={`${tip.code}-${index}`}>{tipText(tip, t, metrics.target_wpm)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {assessment.transcript ? (
        <details className="text-sm">
          <summary className="focus-ring cursor-pointer rounded-sm text-fg-muted">{t("reading.result.transcript")}</summary>
          <p className="mt-1 font-serif text-fg-muted italic">{assessment.transcript}</p>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {onListenModel ? (
          <Button variant="secondary" size="sm" busy={modelBusy} onClick={onListenModel}>
            <WaveIcon />
            {t("reading.shadow.listenModel")}
          </Button>
        ) : null}
        {onTryAgain ? (
          <Button size="sm" onClick={onTryAgain}>
            <RepeatIcon />
            {t("reading.shadow.tryAgain")}
          </Button>
        ) : null}
        {bestPercent !== null ? (
          <span className="nums text-xs text-fg-muted">{t("reading.shadow.attemptsCount", { count: assessment.attempts_for_block, best: bestPercent })}</span>
        ) : null}
      </div>

      {attempts.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[0.8125rem] font-semibold text-fg">{t("reading.shadow.attemptsTitle")}</p>
          <ol className="flex flex-col divide-y divide-line text-sm text-fg-muted">
            {attempts.slice(0, 5).map((attempt) => (
              <li key={attempt.id} className="nums py-1.5">
                {attempt.wpm !== null
                  ? t("reading.shadow.attemptRow", {
                      percent: scoreToPercent(attempt.overall),
                      wpm: formatSpeed(Math.round(attempt.wpm)),
                      date: formatDateTime(attempt.created_at, locale)
                    })
                  : t("reading.shadow.attemptRowNoWpm", { percent: scoreToPercent(attempt.overall), date: formatDateTime(attempt.created_at, locale) })}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
