"use client";

import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, MicIcon, MicOffIcon, StopIcon, VolumeIcon } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { Panel } from "@/components/ui/section";
import { AssessmentResult } from "@/features/reading/components/assessment-result";
import { describeAssessError } from "@/features/reading/components/shadow-panel";
import { fetchWordAudio, useGradeWordMutation, useReviewWordMutation } from "@/features/reading/hooks";
import { isRecordingSupported } from "@/features/reading/lib/recorder";
import { describeRecordingError, useRecording } from "@/features/reading/lib/use-recording";
import { isWebSpeechSupported, speak } from "@/features/reading/lib/web-speech";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import type { ReadingGrade, ReadingWordCard, ReadingWordReview } from "@/types/api";

export const GRADES: readonly ReadingGrade[] = ["again", "hard", "good", "easy"];

/** Plays the word through the API TTS (falls back to the browser voice). */
function useWordAudio(cardId: string, word: string) {
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
    },
    []
  );

  async function play() {
    setBusy(true);
    try {
      if (!urlRef.current) {
        const blob = await fetchWordAudio(cardId);
        urlRef.current = URL.createObjectURL(blob);
      }
      audioRef.current?.pause();
      const audio = new Audio(urlRef.current);
      audioRef.current = audio;
      await audio.play();
    } catch {
      if (isWebSpeechSupported()) {
        speak({ text: word, rate: 0.9 });
      }
    } finally {
      setBusy(false);
    }
  }

  return { play, busy };
}

function CardFront({ card }: { card: ReadingWordCard }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={card.kind === "pronunciation" ? "primary" : "neutral"}>{t(`reading.words.kinds.${card.kind}`)}</Badge>
      </div>
      <p lang="en" className="font-serif text-3xl font-semibold text-fg">
        {card.word}
      </p>
      {card.context ? (
        <p lang="en" className="font-serif text-[0.9375rem] leading-relaxed text-fg-muted italic">
          “{card.context}”
        </p>
      ) : null}
    </div>
  );
}

/** Pronunciation card: listen, record, get the assessment of the word and the resulting grade. */
export function PronunciationReview({ card, onDone }: { card: ReadingWordCard; onDone: () => void }) {
  const { t } = useI18n();
  const audio = useWordAudio(card.id, card.word);
  const review = useReviewWordMutation();
  const [result, setResult] = useState<ReadingWordReview | null>(null);
  const supported = typeof window !== "undefined" ? isRecordingSupported() : true;
  const recorder = useRecording({
    maxSeconds: 15,
    onCaptured: (blob, filename) =>
      review.mutate(
        { id: card.id, blob, filename },
        {
          onSuccess: (value) => setResult(value)
        }
      ),
    shortcut: !result && !review.isPending,
    enabled: supported
  });
  const recorderError = recorder.error ? describeRecordingError(recorder.error, t) : null;

  return (
    <div className="flex flex-col gap-4">
      <CardFront card={card} />
      {card.ipa ? <p className="font-ipa text-sm text-fg-muted">/{card.ipa}/</p> : null}
      {recorderError ? <Alert tone="danger" role="alert" title={recorderError.title} message={recorderError.message} /> : null}
      {review.isError ? <Alert tone="danger" role="alert" message={describeAssessError(review.error, t)} /> : null}
      {!result ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void audio.play()} busy={audio.busy}>
            <VolumeIcon />
            {t("reading.words.session.playWord")}
          </Button>
          {recorder.recording ? (
            <Button variant="danger" onClick={recorder.stop}>
              <StopIcon />
              {t("reading.shadow.stop")}
            </Button>
          ) : (
            <Button onClick={() => void recorder.start()} busy={review.isPending} busyLabel={t("reading.shadow.assessing")} disabled={!supported}>
              {recorder.error === "permission_denied" ? <MicOffIcon /> : <MicIcon />}
              {t("reading.words.session.record")}
            </Button>
          )}
          {!supported ? <span className="text-xs text-fg-muted">{t("reading.shadow.unsupported")}</span> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm font-semibold text-fg">
            {t("reading.words.session.gradeResult", { grade: t(`reading.words.grades.${result.grade}`) })}
          </p>
          <AssessmentResult assessment={result.assessment} compact onPlayWord={() => void audio.play()} />
          <div>
            <Button onClick={onDone}>
              {t("reading.words.session.next")}
              <ArrowRightIcon />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Vocabulary card: word and context → reveal the meaning → grade it (again / hard / good / easy). */
export function VocabularyReview({ card, onDone }: { card: ReadingWordCard; onDone: () => void }) {
  const { t } = useI18n();
  const audio = useWordAudio(card.id, card.word);
  const grade = useGradeWordMutation();
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <CardFront card={card} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void audio.play()} busy={audio.busy}>
          <VolumeIcon />
          {t("reading.words.session.playWord")}
        </Button>
        {!revealed ? (
          <Button size="sm" onClick={() => setRevealed(true)}>
            {t("reading.words.session.reveal")}
          </Button>
        ) : null}
      </div>
      {revealed ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <dl className="flex flex-col gap-2 rounded-md bg-surface-muted px-4 py-3">
            {card.ipa ? (
              <div>
                <dt className="text-xs font-semibold text-fg-muted">{t("reading.glossary.ipa")}</dt>
                <dd className="font-ipa text-fg">/{card.ipa}/</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs font-semibold text-fg-muted">{t("reading.words.session.meaning")}</dt>
              <dd className="text-base font-medium text-fg">{card.meaning_pt || t("reading.words.session.noMeaning")}</dd>
            </div>
          </dl>
          <div role="group" aria-label={t("reading.words.session.gradeLabel")} className="flex flex-wrap gap-2">
            {GRADES.map((value) => (
              <Button
                key={value}
                variant={value === "again" ? "danger" : value === "good" ? "primary" : "secondary"}
                size="sm"
                disabled={grade.isPending}
                onClick={() => grade.mutate({ id: card.id, grade: value }, { onSuccess: onDone })}
              >
                {t(`reading.words.grades.${value}`)}
              </Button>
            ))}
          </div>
          {grade.isError ? <Alert tone="danger" role="alert" message={readErrorMessage(grade.error, t("reading.words.session.gradeFailed"))} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** A review session over a fixed snapshot of due cards. */
export function ReviewSession({ cards, onFinish }: { cards: ReadingWordCard[]; onFinish: () => void }) {
  const { t } = useI18n();
  const [position, setPosition] = useState(0);
  const card = cards[position];

  if (!card) {
    return (
      <Panel title={t("reading.words.session.doneTitle")}>
        <p role="status" className="text-sm text-fg">
          {t("reading.words.session.done", { count: cards.length })}
        </p>
        <div>
          <Button onClick={onFinish}>{t("reading.words.session.finish")}</Button>
        </div>
      </Panel>
    );
  }

  const next = () => setPosition((previous) => previous + 1);
  return (
    <Panel
      aria-label={t("reading.words.session.title")}
      title={t("reading.words.session.title")}
      description={t("reading.words.session.progress", { index: position + 1, total: cards.length })}
      actions={
        <Button variant="ghost" size="sm" onClick={onFinish}>
          {t("reading.words.session.stop")}
        </Button>
      }
    >
      <Meter value={(position / cards.length) * 100} label={t("reading.words.session.progressLabel")} />
      {card.kind === "pronunciation" ? <PronunciationReview key={card.id} card={card} onDone={next} /> : <VocabularyReview key={card.id} card={card} onDone={next} />}
    </Panel>
  );
}
