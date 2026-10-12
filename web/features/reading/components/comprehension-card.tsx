"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CircleCheckIcon, CircleXIcon, SparkIcon } from "@/components/ui/icons";
import { Panel } from "@/components/ui/section";
import { useAnswerQuizMutation, useGenerateQuizMutation } from "@/features/reading/hooks";
import { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils/cn";
import type { ReadingQuiz, ReadingQuizAnswerResult, ReadingQuizQuestion } from "@/types/api";

/** Message for a comprehension failure (AI off, quota, generation failed). */
export function describeQuizError(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.code === "reading_ai_disabled" || error.status === 404) {
      return t("reading.quiz.errors.disabled");
    }
    if (error.status === 429 || error.code === "reading_ai_quota_exceeded") {
      return t("reading.quiz.errors.quota");
    }
    if (error.status === 502 || error.code === "quiz_generation_failed" || error.code === "reading_ai_failed") {
      return t("reading.quiz.errors.failed");
    }
  }
  return t("reading.quiz.errors.generic");
}

interface AnsweredState {
  choice: string;
  result: ReadingQuizAnswerResult;
}

function QuestionCard({
  sectionId,
  question,
  total,
  previous,
  onAnswered
}: {
  sectionId: string;
  question: ReadingQuizQuestion;
  total: number;
  previous: { choice: string; correct: boolean } | null;
  onAnswered: (result: ReadingQuizAnswerResult) => void;
}) {
  const { t } = useI18n();
  const name = useId();
  const answer = useAnswerQuizMutation(sectionId);
  const [choice, setChoice] = useState<string | null>(previous?.choice ?? null);
  const [answered, setAnswered] = useState<AnsweredState | null>(null);

  function submit() {
    if (!choice) {
      return;
    }
    answer.mutate(
      { questionIndex: question.index, choice },
      {
        onSuccess: (result) => {
          setAnswered({ choice, result });
          onAnswered(result);
        }
      }
    );
  }

  const legendId = `${name}-legend`;
  return (
    <li className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <fieldset className="flex flex-col gap-2" aria-labelledby={legendId} disabled={Boolean(answered) || answer.isPending}>
        <legend id={legendId} className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{t("reading.quiz.question", { index: question.index + 1, total })}</span>
          <span lang="en" className="text-[0.9375rem] font-medium text-fg">
            {question.prompt}
          </span>
        </legend>
        {question.options.map((option) => {
          const isCorrectKey = answered?.result.correct_key === option.key;
          const isWrongChoice = answered && answered.choice === option.key && !answered.result.correct;
          return (
            <label
              key={option.key}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                isCorrectKey ? "border-success/50 bg-success-soft" : isWrongChoice ? "border-danger/50 bg-danger-soft" : "border-line hover:bg-surface-muted"
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.key}
                checked={choice === option.key}
                onChange={() => setChoice(option.key)}
                className="mt-0.5 accent-primary"
              />
              <span className="font-semibold text-fg-muted">{option.key}.</span>
              <span lang="en" className="text-fg">
                {option.text}
              </span>
              {isCorrectKey ? <CircleCheckIcon className="ml-auto shrink-0 text-success" aria-hidden={false} aria-label={t("reading.quiz.correctOption")} /> : null}
              {isWrongChoice ? <CircleXIcon className="ml-auto shrink-0 text-danger" aria-hidden={false} aria-label={t("reading.quiz.yourChoice")} /> : null}
            </label>
          );
        })}
      </fieldset>
      {!answered && previous ? (
        <p className="text-xs text-fg-muted">
          {t("reading.quiz.previousAnswer", { choice: previous.choice, result: previous.correct ? t("reading.quiz.correctShort") : t("reading.quiz.incorrectShort") })}
        </p>
      ) : null}
      {!answered ? (
        <div>
          <Button size="sm" onClick={submit} disabled={!choice} busy={answer.isPending}>
            {t("reading.quiz.answer")}
          </Button>
        </div>
      ) : null}
      {answer.isError ? <Alert tone="danger" role="alert" message={describeQuizError(answer.error, t)} /> : null}
      {answered ? (
        <div role="status" className="flex flex-col gap-2">
          <p className={cn("inline-flex items-center gap-2 text-sm font-semibold", answered.result.correct ? "text-success" : "text-danger")}>
            {answered.result.correct ? <CircleCheckIcon /> : <CircleXIcon />}
            {answered.result.correct ? t("reading.quiz.correct") : t("reading.quiz.incorrect", { key: answered.result.correct_key })}
          </p>
          {answered.result.explanation ? (
            <p className="text-sm text-fg">
              <span className="font-semibold">{t("reading.quiz.explanation")}: </span>
              {answered.result.explanation}
            </p>
          ) : null}
          {answered.result.evidence ? (
            <figure className="flex flex-col gap-1">
              <figcaption className="text-xs font-semibold text-fg-muted">{t("reading.quiz.evidence")}</figcaption>
              <blockquote lang="en" className="border-l-2 border-primary/50 pl-3 font-serif text-sm text-fg italic">
                “{answered.result.evidence}”
              </blockquote>
            </figure>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** "Test your comprehension" at the end of a section: 3 AI questions with literal evidence. */
export function ComprehensionCard({ sectionId, aiAvailable }: { sectionId: string; aiAvailable: boolean }) {
  const { t } = useI18n();
  const generate = useGenerateQuizMutation(sectionId);
  // The quiz lives in the query cache (set by the mutation) so it survives re-renders of the reader.
  const cached = useQuery<ReadingQuiz | null>({
    queryKey: queryKeys.readingQuiz(sectionId),
    queryFn: () => null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY
  });
  const [score, setScore] = useState<{ answered: number; correct: number } | null>(null);

  if (!aiAvailable) {
    return null;
  }

  const quiz = generate.data ?? cached.data ?? null;
  const total = quiz?.questions.length ?? 0;
  const initialCorrect = quiz ? quiz.answers.filter((item) => item.correct).length : 0;
  const shownScore = score ?? (quiz && quiz.answers.length ? { answered: quiz.answers.length, correct: initialCorrect } : null);

  return (
    <Panel
      aria-label={t("reading.quiz.title")}
      title={t("reading.quiz.title")}
      description={quiz ? undefined : t("reading.quiz.intro")}
      actions={
        shownScore && total ? (
          <span className="nums text-sm font-semibold text-fg" role="status">
            {t("reading.quiz.score", { correct: shownScore.correct, total })}
          </span>
        ) : null
      }
    >
      {generate.isError ? <Alert tone="danger" role="alert" message={describeQuizError(generate.error, t)} /> : null}
      {!quiz ? (
        <div>
          <Button onClick={() => generate.mutate()} busy={generate.isPending} busyLabel={t("reading.quiz.generating")}>
            <SparkIcon />
            {t("reading.quiz.generate")}
          </Button>
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          {quiz.questions.map((question) => {
            const previous = quiz.answers.find((item) => item.question_index === question.index) ?? null;
            return (
              <QuestionCard
                key={`${quiz.quiz_id}-${question.index}`}
                sectionId={sectionId}
                question={question}
                total={total}
                previous={previous ? { choice: previous.choice, correct: previous.correct } : null}
                onAnswered={(result) => setScore({ answered: result.answered, correct: result.correct_count })}
              />
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
