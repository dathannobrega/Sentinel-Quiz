"use client";

import { CheckIcon, ClockIcon } from "@/components/ui/icons";
import { ItemTypeIcon } from "@/features/quiz-builder/components/icons";
import { DEFAULT_NUMERIC, OPTION_TYPES, SCORED_TYPES, TIMED_TYPES } from "@/features/quiz-builder/lib/items";
import { formatWithUnit, rangeFraction } from "@/features/quiz-live/lib/numeric";
import { ANSWER_LETTERS, ANSWER_SHAPES, themeStageStyle } from "@/features/quiz-builder/lib/themes";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveItem, LiveThemeKey } from "@/types/api";

interface StagePreviewProps {
  item: LiveItem | null;
  themeKey: LiveThemeKey;
  position: number;
  total: number;
}

/**
 * Projector (16:9) and phone previews of the selected item, rendered from the local draft (no
 * round trip). The stage sets data-lq-theme so web/styles/live-themes.css tokens apply when loaded.
 */
export function StagePreview({ item, themeKey, position, total }: StagePreviewProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[0.8125rem] font-semibold tracking-[0.06em] text-fg-muted uppercase">{t("quizBuilder.preview.label")}</h2>
        <p className="hidden text-xs text-fg-subtle sm:block">{t("quizBuilder.preview.hint")}</p>
      </div>
      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_11rem]">
        <ProjectorStage item={item} themeKey={themeKey} position={position} total={total} />
        {item ? <PhoneStage item={item} themeKey={themeKey} /> : null}
      </div>
    </div>
  );
}

function ProjectorStage({ item, themeKey, position, total }: StagePreviewProps) {
  const { t } = useI18n();
  const stageStyle = themeStageStyle(themeKey);
  return (
    <figure
      data-lq-theme={themeKey}
      style={stageStyle}
      aria-label={t("quizBuilder.preview.label")}
      className={cn(
        "@container relative isolate flex aspect-video w-full flex-col overflow-hidden rounded-lg shadow-overlay",
        "[background:var(--qb-pattern),var(--qb-bg)] font-[family-name:var(--qb-font)] text-[var(--qb-fg)]",
        themeKey === "high_contrast" && "outline-3 -outline-offset-3 outline-[var(--qb-accent)]"
      )}
    >
      {!item ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-[clamp(0.8rem,2cqw,1.1rem)] text-[var(--qb-muted)]">
          {t("quizBuilder.preview.empty")}
        </div>
      ) : (
        <div key={`${item.id}-${item.item_type}`} className="flex flex-1 flex-col gap-[3cqw] p-[4cqw] motion-safe:animate-[rise-in_260ms_var(--ease-out)]">
          <header className="flex items-center justify-between gap-[2cqw] text-[clamp(0.6rem,1.5cqw,0.95rem)] text-[var(--qb-muted)]">
            <span className="inline-flex items-center gap-[1cqw] font-medium">
              <ItemTypeIcon type={item.item_type} className="size-[2cqw] min-h-3 min-w-3" />
              {t("quizBuilder.preview.question", { position, total })}
            </span>
            {TIMED_TYPES.has(item.item_type) ? (
              <span className="flex items-center gap-[1.2cqw]">
                {SCORED_TYPES.has(item.item_type) ? (
                  <span className="rounded-full border border-current/30 px-[1.2cqw] py-[0.3cqw]">
                    {item.points_multiplier === 0
                      ? t("quizBuilder.preview.noPoints")
                      : t("quizBuilder.preview.points", { count: item.points_multiplier })}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-[0.6cqw] rounded-full bg-[var(--qb-surface)] px-[1.4cqw] py-[0.4cqw] font-semibold text-[var(--qb-fg)]">
                  <ClockIcon className="size-[1.8cqw] min-h-3 min-w-3" />
                  {item.time_limit_s === null ? t("quizBuilder.preview.noTimer") : t("quizBuilder.preview.seconds", { count: item.time_limit_s })}
                </span>
              </span>
            ) : null}
          </header>
          <StageBody item={item} />
        </div>
      )}
    </figure>
  );
}

function StageBody({ item }: { item: LiveItem }) {
  const { t, locale } = useI18n();
  const prompt = item.prompt.trim();
  const promptNode = (
    <p
      className={cn(
        "text-center leading-[1.2] font-bold tracking-[-0.01em] text-balance break-words",
        prompt ? "text-[var(--qb-fg)]" : "text-[var(--qb-muted)] italic",
        prompt.length > 160 ? "text-[clamp(0.8rem,2.4cqw,1.9rem)]" : prompt.length > 90 ? "text-[clamp(0.9rem,3cqw,2.3rem)]" : "text-[clamp(1rem,3.8cqw,2.8rem)]"
      )}
    >
      {prompt || t("quizBuilder.preview.promptPlaceholder")}
    </p>
  );

  if (item.item_type === "leaderboard") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-[2cqw]">
        <p className="text-[clamp(1rem,3.6cqw,2.6rem)] font-bold">{t("quizBuilder.preview.leaderboard")}</p>
        <ol className="flex w-3/5 flex-col gap-[1cqw]" aria-hidden="true">
          {[92, 78, 64, 51, 40].map((width, index) => (
            <li key={width} className="flex items-center gap-[1.2cqw]">
              <span className="w-[3cqw] text-right font-mono text-[clamp(0.6rem,1.6cqw,1rem)] text-[var(--qb-muted)]">{index + 1}</span>
              <span
                className="h-[2.6cqw] rounded-[0.6cqw] motion-safe:animate-[grow-x_600ms_var(--ease-out)_both] origin-left"
                style={{ width: `${width}%`, background: `var(--qb-answer-${index + 1})`, animationDelay: `${index * 60}ms` }}
              />
            </li>
          ))}
        </ol>
        <p className="text-[clamp(0.6rem,1.5cqw,0.95rem)] text-[var(--qb-muted)]">{t("quizBuilder.preview.leaderboardHint")}</p>
      </div>
    );
  }

  if (item.item_type === "content") {
    return (
      <div className="flex flex-1 flex-col justify-center gap-[2cqw]">
        {prompt ? promptNode : null}
        <p className="mx-auto max-w-[85%] text-center text-[clamp(0.7rem,2.1cqw,1.5rem)] leading-relaxed whitespace-pre-line text-[var(--qb-fg)]">
          {item.body?.trim() || t("quizBuilder.preview.content")}
        </p>
      </div>
    );
  }

  if (item.item_type === "type_answer") {
    return (
      <div className="flex flex-1 flex-col justify-center gap-[3cqw]">
        {promptNode}
        <div className="mx-auto flex w-3/4 items-center justify-center rounded-[1cqw] border-[0.3cqw] border-dashed border-[var(--qb-accent)] bg-[var(--qb-surface)] px-[2cqw] py-[1.6cqw] text-[clamp(0.65rem,1.8cqw,1.2rem)] text-[var(--qb-muted)]">
          {t("quizBuilder.preview.typeAnswer")}
        </div>
      </div>
    );
  }

  if (item.item_type === "ordering") {
    return (
      <div className="flex flex-1 flex-col gap-[2.4cqw]">
        <div className="flex flex-1 items-center justify-center">{promptNode}</div>
        <ol className="mx-auto flex w-4/5 flex-col gap-[1cqw]">
          {item.options.map((option, index) => (
            <li
              key={`${option.key}-${index}`}
              className="flex items-center gap-[1.4cqw] rounded-[1cqw] px-[1.8cqw] py-[0.9cqw] motion-safe:animate-[rise-in_280ms_var(--ease-out)_both]"
              style={{ background: `var(--qb-answer-${index + 1})`, color: `var(--qb-on-answer-${index + 1})`, animationDelay: `${index * 50}ms` }}
            >
              <span className="font-mono text-[clamp(0.6rem,1.6cqw,1rem)] font-bold">{index + 1}</span>
              <span className={cn("min-w-0 flex-1 text-[clamp(0.65rem,1.8cqw,1.3rem)] leading-tight font-semibold break-words", !option.text.trim() && "italic opacity-70")}>
                {option.text.trim() || t("quizBuilder.preview.orderingPlaceholder", { n: index + 1 })}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-center text-[clamp(0.55rem,1.4cqw,0.9rem)] text-[var(--qb-muted)]">{t("quizBuilder.preview.orderingHint")}</p>
      </div>
    );
  }

  if (item.item_type === "numeric") {
    const numeric = { ...DEFAULT_NUMERIC, ...item.numeric };
    const min = numeric.min ?? 0;
    const max = numeric.max ?? 0;
    const value = numeric.value;
    const valid = min < max;
    return (
      <div className="flex flex-1 flex-col justify-center gap-[3cqw]">
        {promptNode}
        <div className="mx-auto flex w-4/5 flex-col gap-[1cqw]" aria-hidden="true">
          <div className="relative h-[1.4cqw] rounded-full bg-[var(--qb-surface)]">
            {valid && value !== null && numeric.tolerance > 0 ? (
              <span
                className="absolute inset-y-0 rounded-full bg-[var(--qb-accent)] opacity-40"
                style={{
                  left: `${rangeFraction(value - numeric.tolerance, min, max) * 100}%`,
                  right: `${100 - rangeFraction(value + numeric.tolerance, min, max) * 100}%`
                }}
              />
            ) : null}
            {valid && value !== null ? (
              <span className="absolute -top-[0.8cqw] -bottom-[0.8cqw] w-[0.5cqw] -translate-x-1/2 rounded-full bg-[var(--qb-accent)]" style={{ left: `${rangeFraction(value, min, max) * 100}%` }} />
            ) : null}
          </div>
          <div className="flex justify-between font-mono text-[clamp(0.55rem,1.4cqw,0.95rem)] text-[var(--qb-muted)]">
            <span>{formatWithUnit(min, numeric.unit, locale)}</span>
            <span>{formatWithUnit(max, numeric.unit, locale)}</span>
          </div>
        </div>
        <p className="text-center text-[clamp(0.6rem,1.6cqw,1.05rem)] text-[var(--qb-muted)]">
          {value !== null
            ? t("quizBuilder.preview.numericAnswer", {
                value: formatWithUnit(value, numeric.unit, locale),
                tolerance: numeric.tolerance ? ` ± ${formatWithUnit(numeric.tolerance, numeric.unit, locale)}` : ""
              })
            : t("quizBuilder.preview.numericNoValue")}
        </p>
      </div>
    );
  }

  if (item.item_type === "word_cloud") {
    const sample = [
      { word: t("quizBuilder.preview.cloudSample1"), size: 4.2, tone: 1 },
      { word: t("quizBuilder.preview.cloudSample2"), size: 3, tone: 2 },
      { word: t("quizBuilder.preview.cloudSample3"), size: 2.4, tone: 3 },
      { word: t("quizBuilder.preview.cloudSample4"), size: 2, tone: 4 },
      { word: t("quizBuilder.preview.cloudSample5"), size: 1.6, tone: 5 }
    ];
    return (
      <div className="flex flex-1 flex-col gap-[2cqw]">
        {promptNode}
        <div aria-hidden="true" className="flex flex-1 flex-wrap content-center items-center justify-center gap-x-[2.4cqw] gap-y-[0.6cqw] opacity-70">
          {sample.map((entry) => (
            <span key={entry.word} className="leading-none font-extrabold" style={{ fontSize: `${entry.size}cqw`, color: `var(--qb-answer-${entry.tone})` }}>
              {entry.word}
            </span>
          ))}
        </div>
        <p className="text-center text-[clamp(0.55rem,1.4cqw,0.9rem)] text-[var(--qb-muted)]">
          {t("quizBuilder.preview.cloudHint", { count: item.max_words ?? 1 })}
        </p>
      </div>
    );
  }

  const options = OPTION_TYPES.has(item.item_type) ? item.options : [];
  const showCorrect = item.item_type !== "poll";
  const columns = options.length <= 2 ? "grid-cols-2" : options.length <= 4 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className="flex flex-1 flex-col gap-[3cqw]">
      <div className="flex flex-1 items-center justify-center">{promptNode}</div>
      <ul className={cn("grid gap-[1.4cqw]", columns)}>
        {options.map((option, index) => (
          <li
            key={`${option.key}-${index}`}
            className="relative flex min-h-[8cqw] items-center gap-[1.4cqw] rounded-[1cqw] px-[1.8cqw] py-[1.2cqw] motion-safe:animate-[rise-in_280ms_var(--ease-out)_both]"
            style={{
              background: `var(--qb-answer-${index + 1})`,
              color: `var(--qb-on-answer-${index + 1})`,
              animationDelay: `${index * 50}ms`
            }}
          >
            <span aria-hidden="true" className="text-[clamp(0.7rem,2cqw,1.4rem)] leading-none">
              {ANSWER_SHAPES[index]}
            </span>
            <span className="font-mono text-[clamp(0.6rem,1.5cqw,1rem)] font-bold opacity-80">{ANSWER_LETTERS[index]}</span>
            <span className={cn("min-w-0 flex-1 text-[clamp(0.65rem,1.9cqw,1.35rem)] leading-tight font-semibold break-words", !option.text.trim() && "italic opacity-70")}>
              {option.text.trim() || t("quizBuilder.preview.optionPlaceholder", { letter: ANSWER_LETTERS[index] ?? "" })}
            </span>
            {showCorrect && option.correct ? (
              <span className="inline-flex shrink-0 items-center gap-[0.5cqw] rounded-full bg-[rgb(0_0_0/0.78)] px-[1cqw] py-[0.4cqw] text-[clamp(0.55rem,1.3cqw,0.85rem)] font-semibold text-[#fff]">
                <CheckIcon className="size-[1.6cqw] min-h-2.5 min-w-2.5" />
                {t("quizBuilder.preview.correct")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhoneStage({ item, themeKey }: { item: LiveItem; themeKey: LiveThemeKey }) {
  const options = OPTION_TYPES.has(item.item_type) ? item.options : [];
  return (
    <div
      aria-hidden="true"
      data-lq-theme={themeKey}
      style={themeStageStyle(themeKey)}
      className="mx-auto hidden aspect-[9/16] w-44 flex-col gap-2 overflow-hidden rounded-[1.4rem] border-4 border-fg/80 p-3 shadow-overlay [background:var(--qb-bg)] 2xl:flex"
    >
      <span className="mx-auto mb-1 h-1 w-10 rounded-full bg-[var(--qb-muted)] opacity-50" />
      {item.item_type === "type_answer" || item.item_type === "word_cloud" ? (
        <div className="mt-auto flex flex-col gap-2">
          {Array.from({ length: item.item_type === "word_cloud" ? (item.max_words ?? 1) : 1 }, (_, index) => (
            <span key={index} className="h-8 rounded-md border-2 border-[var(--qb-accent)] bg-[var(--qb-surface)]" />
          ))}
          <span className="h-8 rounded-md bg-[var(--qb-accent)]" />
        </div>
      ) : item.item_type === "numeric" ? (
        <div className="mt-auto flex flex-col gap-3">
          <span className="h-10 rounded-md border-2 border-[var(--qb-accent)] bg-[var(--qb-surface)]" />
          <span className="relative h-1.5 rounded-full bg-[var(--qb-surface)]">
            <span className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--qb-accent)]" />
          </span>
          <span className="h-8 rounded-md bg-[var(--qb-accent)]" />
        </div>
      ) : item.item_type === "ordering" ? (
        <div className="mt-auto flex flex-col gap-1.5">
          {item.options.map((option, index) => (
            <span key={`${option.key}-${index}`} className="flex h-7 items-center gap-1 rounded-md bg-[var(--qb-surface)] px-1.5" style={{ borderLeft: `4px solid var(--qb-answer-${index + 1})` }}>
              <span className="h-1.5 flex-1 rounded-full bg-[var(--qb-muted)] opacity-40" />
              <span className="text-[0.55rem] text-[var(--qb-muted)]">▲▼</span>
            </span>
          ))}
          <span className="mt-1 h-8 rounded-md bg-[var(--qb-accent)]" />
        </div>
      ) : options.length ? (
        <div className={cn("mt-auto grid flex-1 gap-1.5", options.length > 2 ? "grid-cols-2" : "grid-cols-1")}>
          {options.map((option, index) => (
            <span
              key={`${option.key}-${index}`}
              className="grid place-items-center rounded-md text-lg"
              style={{ background: `var(--qb-answer-${index + 1})`, color: `var(--qb-on-answer-${index + 1})` }}
            >
              {ANSWER_SHAPES[index]}
            </span>
          ))}
        </div>
      ) : (
        <div className="grid flex-1 place-items-center">
          <span className="size-10 rounded-full border-2 border-[var(--qb-accent)]" />
        </div>
      )}
    </div>
  );
}
