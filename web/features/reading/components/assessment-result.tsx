"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertIcon, CircleCheckIcon, CircleXIcon, GaugeIcon, InfoIcon, PlusSquareIcon, RepeatIcon, StrikeIcon, WaveIcon, XIcon, MicIcon } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { formatSpeed, scoreToPercent } from "@/features/reading/lib/format";
import { PHONEME_QUALITY_CLASS, PHONEME_QUALITY_KEY, reasonLabelKey, STATUS_CLASS, STATUS_LABEL_KEY } from "@/features/reading/lib/word-status";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { ReadingAssessedWord, ReadingAssessment, ReadingPhonemesReason, ReadingAttemptSummary, ReadingScores, ReadingTip, ReadingWordStatus } from "@/types/api";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface AssessmentResultProps {
  assessment: ReadingAssessment;
  /** Plays the whole model (TTS) audio of the block. */
  onListenModel?: () => void;
  /** Plays the model audio of one word. */
  onPlayWord?: (word: ReadingAssessedWord) => void;
  /** Plays the learner's own recording of that word (kept only in the browser). */
  onPlayMine?: (word: ReadingAssessedWord) => void;
  /** Why phoneme analysis is off (from capabilities), for a precise notice. */
  phonemesOffReason?: ReadingPhonemesReason | null;
  onTryAgain?: () => void;
  modelBusy?: boolean;
  /** Recent attempts for this block (most recent first). */
  attempts?: ReadingAttemptSummary[];
  isNewBest?: boolean;
  /** Compact layout (word review): no legend, transcript or attempt history. */
  compact?: boolean;
}

type IconComponent = typeof CircleCheckIcon;

const STATUS_ICON: Record<ReadingWordStatus, IconComponent> = {
  ok: CircleCheckIcon,
  weak: AlertIcon,
  mispronounced: CircleXIcon,
  missed: StrikeIcon
};

const BREAK_MARK = "‖";

function wordTitle(word: ReadingAssessedWord, t: Translate): string {
  const parts = [t(STATUS_LABEL_KEY[word.status])];
  const reason = reasonLabelKey(word.reason);
  if (reason) {
    parts.push(t(reason));
  }
  if (word.heard && word.status !== "ok") {
    parts.push(t("reading.result.heard", { heard: word.heard }));
  }
  if (word.expected_ipa) {
    parts.push(t("reading.result.expectedIpa", { ipa: `/${word.expected_ipa}/` }));
  }
  if (word.heard_ipa) {
    parts.push(t("reading.result.heardIpa", { ipa: `/${word.heard_ipa}/` }));
  }
  if (word.break === "unexpected") {
    parts.push(t("reading.result.breakUnexpected"));
  } else if (word.break === "missing") {
    parts.push(t("reading.result.breakMissing"));
  }
  return parts.join(" · ");
}

/** A word deserves a detail panel when it is not plain `ok` or carries phoneme / pause data. */
function hasDetails(word: ReadingAssessedWord): boolean {
  return word.status !== "ok" || Boolean(word.phonemes?.length) || Boolean(word.break) || Boolean(word.reason);
}

function Legend({ withBreaks }: { withBreaks: boolean }) {
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
      {withBreaks ? (
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="font-semibold text-warning">
            {BREAK_MARK}
          </span>
          <span>{t("reading.result.legendBreak")}</span>
        </li>
      ) : null}
    </ul>
  );
}

function tipText(tip: ReadingTip, t: Translate, target: [number, number]): string {
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

/** Detail of one word: status, reason, phonemes (quality in text), expected × heard IPA, model audio. */
export function WordDetail({
  word,
  onPlayWord,
  onPlayMine,
  onClose
}: {
  word: ReadingAssessedWord;
  onPlayWord?: (word: ReadingAssessedWord) => void;
  onPlayMine?: (word: ReadingAssessedWord) => void;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const reason = reasonLabelKey(word.reason);
  const phonemes = word.phonemes ?? [];
  return (
    <div role="region" aria-label={t("reading.result.wordDetails")} className="flex flex-col gap-3 rounded-md border border-line bg-surface-muted px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-serif text-base font-semibold text-fg">{word.text}</span>
        <span className="text-fg-muted">{t(STATUS_LABEL_KEY[word.status])}</span>
        {reason ? <span className="text-fg-muted">· {t(reason)}</span> : null}
        {typeof word.phoneme_score === "number" ? (
          <span className="nums text-fg-muted">· {t("reading.result.phonemeScore", { percent: scoreToPercent(word.phoneme_score) })}</span>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="focus-ring ml-auto inline-grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface hover:text-fg"
            aria-label={t("reading.result.closeDetails")}
          >
            <XIcon size={14} />
          </button>
        ) : null}
      </div>
      {word.heard && word.status !== "ok" ? <p className="text-fg-muted">{t("reading.result.heard", { heard: word.heard })}</p> : null}
      {word.expected_ipa || word.heard_ipa ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {word.expected_ipa ? (
            <>
              <dt className="text-fg-muted">{t("reading.result.expected")}</dt>
              <dd className="font-ipa text-fg">/{word.expected_ipa}/</dd>
            </>
          ) : null}
          {word.heard_ipa ? (
            <>
              <dt className="text-fg-muted">{t("reading.result.heardLabel")}</dt>
              <dd className="font-ipa text-fg">/{word.heard_ipa}/</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {phonemes.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-fg">{t("reading.result.phonemesTitle")}</p>
          <ul aria-label={t("reading.result.phonemesTitle")} className="flex flex-wrap gap-1.5">
            {phonemes.map((phoneme, index) => {
              const differs = phoneme.heard !== null && phoneme.heard !== phoneme.ipa;
              return (
                <li key={`${phoneme.ipa}-${index}`} className={cn("inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs", PHONEME_QUALITY_CLASS[phoneme.quality])}>
                  <span className="font-ipa text-[0.8125rem] font-semibold">/{phoneme.ipa}/</span>
                  <span>{t(PHONEME_QUALITY_KEY[phoneme.quality])}</span>
                  {differs ? <span className="font-ipa">{t("reading.result.phonemeHeard", { heard: `/${phoneme.heard}/` })}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {word.break ? <p className="text-fg-muted">{word.break === "unexpected" ? t("reading.result.breakUnexpected") : t("reading.result.breakMissing")}</p> : null}
      {onPlayWord || (onPlayMine && word.start !== null && word.start !== undefined) ? (
        <div className="flex flex-wrap gap-2">
          {onPlayWord ? (
            <Button variant="secondary" size="sm" onClick={() => onPlayWord(word)} aria-label={t("reading.result.playWord", { word: word.text })}>
              <WaveIcon />
              {t("reading.shadow.listenModel")}
            </Button>
          ) : null}
          {onPlayMine && word.start !== null && word.start !== undefined ? (
            <Button variant="secondary" size="sm" onClick={() => onPlayMine(word)} aria-label={t("reading.result.playMineWord", { word: word.text })}>
              <MicIcon />
              {t("reading.result.playMine")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Message for "phoneme analysis off", by the reason the capabilities reported. */
const PHONEMES_OFF_KEY: Record<ReadingPhonemesReason | "unknown", string> = {
  warming: "reading.result.phonemesWarming",
  failed: "reading.result.phonemesFailed",
  disabled: "reading.result.phonemesDisabled",
  speech_unavailable: "reading.result.phonemesOff",
  unknown: "reading.result.phonemesOff"
};

/** Notices from the prosody analysis and the engines (monotone, pauses, phoneme analysis off). */
function ProsodyNotices({ assessment }: { assessment: ReadingAssessment }) {
  const { t } = useI18n();
  const prosody = assessment.prosody;
  const notices: string[] = [];
  if (prosody?.monotone) {
    notices.push(
      prosody.pitch_range_semitones !== null && prosody.pitch_range_semitones !== undefined
        ? t("reading.result.monotone", { semitones: prosody.pitch_range_semitones.toFixed(1) })
        : t("reading.result.monotoneShort")
    );
  }
  if (prosody && prosody.unexpected_breaks > 0) {
    notices.push(t("reading.result.unexpectedBreaks", { count: prosody.unexpected_breaks }));
  }
  if (prosody && prosody.missing_breaks > 0) {
    notices.push(t("reading.result.missingBreaks", { count: prosody.missing_breaks }));
  }
  if (!notices.length) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[0.8125rem] font-semibold text-fg">{t("reading.result.prosodyTitle")}</p>
      <ul className="flex flex-col gap-1 text-sm text-fg">
        {notices.map((notice) => (
          <li key={notice} className="inline-flex items-start gap-2">
            <AlertIcon size={14} className="mt-0.5 shrink-0 text-warning" />
            <span>{notice}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "2 words went to your review" with a link to /read/words. */
export function DeckNotice({ added }: { added: number | undefined }) {
  const { t } = useI18n();
  if (!added || added <= 0) {
    return null;
  }
  return (
    <Alert
      tone="neutral"
      message={added === 1 ? t("reading.result.deckAddedOne") : t("reading.result.deckAddedOther", { count: added })}
      action={
        <Link href="/read/words" className="focus-ring rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline">
          {t("reading.result.deckLink")}
        </Link>
      }
    />
  );
}

/**
 * Shadowing result: the text re-rendered with each word marked by status (tap/Enter opens the
 * phoneme detail), legend, scores (prosody when available), pace, prosody notices, tips and the
 * block's recent attempts.
 */
export function AssessmentResult({
  assessment,
  onListenModel,
  onPlayWord,
  onPlayMine,
  phonemesOffReason = null,
  onTryAgain,
  modelBusy = false,
  attempts = [],
  isNewBest = false,
  compact = false
}: AssessmentResultProps) {
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

  const breakMark = (key: string, label: string) => (
    <span key={key} className="mx-0.5 font-sans font-semibold text-warning" title={label}>
      <span aria-hidden="true">{BREAK_MARK}</span>
      <span className="sr-only">{label}</span>
    </span>
  );

  // Rebuild the text from the reference, so punctuation and spacing are preserved.
  const nodes: ReactNode[] = [renderExtras(-1)];
  let cursor = 0;
  const sortedWords = [...assessment.words].sort((a, b) => a.char_start - b.char_start);
  sortedWords.forEach((word) => {
    if (word.char_start > cursor) {
      nodes.push(assessment.text.slice(cursor, word.char_start));
    }
    if (word.break === "unexpected") {
      nodes.push(breakMark(`b-${word.index}`, t("reading.result.breakUnexpected")));
    }
    const surface = assessment.text.slice(word.char_start, word.char_end) || word.text;
    const WordIcon = STATUS_ICON[word.status];
    if (!hasDetails(word)) {
      nodes.push(<span key={`w-${word.index}`}>{surface}</span>);
    } else {
      nodes.push(
        <button
          key={`w-${word.index}`}
          type="button"
          title={wordTitle(word, t)}
          aria-expanded={selected === word.index}
          onClick={() => setSelected((previous) => (previous === word.index ? null : word.index))}
          className={cn("focus-ring inline rounded-sm px-0.5 text-left font-serif", STATUS_CLASS[word.status], selected === word.index && "bg-primary-soft")}
        >
          {word.status !== "ok" ? <WordIcon size={11} className="mr-0.5 inline -translate-y-px" /> : null}
          {surface}
          {word.status === "mispronounced" && word.heard && word.reason !== "phoneme" ? (
            <span className="ml-1 font-sans text-[0.6875rem] text-danger">({t("reading.result.heard", { heard: word.heard })})</span>
          ) : null}
        </button>
      );
    }
    if (word.break === "missing") {
      nodes.push(breakMark(`m-${word.index}`, t("reading.result.breakMissing")));
    }
    nodes.push(renderExtras(word.index));
    cursor = Math.max(cursor, word.char_end);
  });
  if (cursor < assessment.text.length) {
    nodes.push(assessment.text.slice(cursor));
  }

  const selectedWord = selected === null ? null : (assessment.words.find((word) => word.index === selected) ?? null);
  const scores: Array<{ key: keyof ReadingScores; label: string }> = [
    { key: "overall", label: t("reading.result.scores.overall") },
    { key: "accuracy", label: t("reading.result.scores.accuracy") },
    { key: "completeness", label: t("reading.result.scores.completeness") },
    { key: "fluency", label: t("reading.result.scores.fluency") }
  ];
  if (typeof assessment.scores.prosody === "number") {
    scores.push({ key: "prosody", label: t("reading.result.scores.prosody") });
  }
  const metrics = assessment.metrics;
  const bestPercent = assessment.best_overall === null || assessment.best_overall === undefined ? null : scoreToPercent(assessment.best_overall);
  const withBreaks = assessment.words.some((word) => Boolean(word.break));
  const phonemesOff = !assessment.engines?.phoneme;

  return (
    <section aria-label={t("reading.result.title")} className="flex flex-col gap-5">
      {isNewBest ? (
        <p role="status" className="inline-flex items-center gap-2 text-sm font-medium text-success">
          <CircleCheckIcon />
          {t("reading.result.newBest")}
        </p>
      ) : null}

      <p className="font-serif text-[1.0625rem] leading-[1.9] text-fg">{nodes}</p>

      {selectedWord ? <WordDetail word={selectedWord} onPlayWord={onPlayWord} onPlayMine={onPlayMine} onClose={() => setSelected(null)} /> : null}

      {compact ? null : <Legend withBreaks={withBreaks} />}

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

      {compact ? null : (
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
      )}

      <ProsodyNotices assessment={assessment} />

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

      <DeckNotice added={assessment.deck?.added} />

      {phonemesOff ? (
        <p className="inline-flex items-start gap-1.5 text-xs text-fg-muted">
          <InfoIcon size={13} className="mt-px shrink-0" />
          {t(PHONEMES_OFF_KEY[phonemesOffReason ?? "unknown"])}
        </p>
      ) : null}

      {assessment.transcript && !compact ? (
        <details className="text-sm">
          <summary className="focus-ring cursor-pointer rounded-sm text-fg-muted">{t("reading.result.transcript")}</summary>
          <p className="mt-1 font-serif text-fg-muted italic">{assessment.transcript}</p>
        </details>
      ) : null}

      {onListenModel || onTryAgain || bestPercent !== null ? (
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
          {bestPercent !== null && !compact ? (
            <span className="nums text-xs text-fg-muted">{t("reading.shadow.attemptsCount", { count: assessment.attempts_for_block, best: bestPercent })}</span>
          ) : null}
        </div>
      ) : null}

      {attempts.length && !compact ? (
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
