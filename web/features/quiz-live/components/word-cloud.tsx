"use client";

import { useMemo } from "react";

import type { WordCloudResults } from "@/features/quiz-live/lib/protocol";
import { layoutWordCloud, sortWords, type WordCloudBox } from "@/features/quiz-live/lib/word-cloud";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

const STAGE_BOX: WordCloudBox = { width: 1000, height: 560 };
const COMPACT_BOX: WordCloudBox = { width: 600, height: 420 };
/** Answer colours of the theme, most sent first (never the only cue: size and the list carry it too). */
const TONES = 6;

/**
 * Live word cloud (T08). An SVG with a deterministic layout that scales with its container; the
 * words glide when the counts change (CSS transforms, off with reduced motion / calm mode). The
 * same data is always available as a list for screen readers, and the count of each word shows on
 * hover or focus (`interactive`), so size and colour are never the only cue (contract §11).
 */
export function WordCloud({
  cloud,
  variant = "stage",
  interactive = false,
  className
}: {
  cloud: WordCloudResults | null;
  variant?: "stage" | "compact";
  /** Words become focusable and show their count on focus. */
  interactive?: boolean;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const box = variant === "stage" ? STAGE_BOX : COMPACT_BOX;
  const words = useMemo(() => cloud?.words ?? [], [cloud]);
  const placed = useMemo(() => layoutWordCloud(words, box), [words, box]);
  const format = new Intl.NumberFormat(locale);
  const sorted = useMemo(() => sortWords(words), [words]);

  if (!words.length) {
    return (
      <div className={cn("grid min-h-0 place-items-center", className)}>
        <p className="text-center font-lq text-[max(1rem,2.4cqmin)] font-semibold text-lq-fg-muted">{t("quizPresent.cloud.empty")}</p>
      </div>
    );
  }

  return (
    <figure className={cn("relative flex min-h-0 flex-col", className)}>
      <svg
        viewBox={`0 0 ${box.width} ${box.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="min-h-0 w-full flex-1 overflow-visible"
        aria-hidden={interactive ? undefined : true}
        role={interactive ? "group" : undefined}
        aria-label={interactive ? t("quizPresent.cloud.label") : undefined}
      >
        {placed.map((word) => {
          const tone = (word.rank % TONES) + 1;
          const label = t("quizPresent.cloud.wordCount", { word: word.text, count: format.format(word.n) });
          return (
            <g key={word.key} className="lq-cloud-word group" style={{ transform: `translate(${word.x}px, ${word.y}px)` }}>
              <g
                className="lq-cloud-pop outline-none"
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? "img" : undefined}
                aria-label={interactive ? label : undefined}
              >
                <title>{label}</title>
                <rect
                  x={-word.width / 2 - 8}
                  y={-word.height / 2 - 4}
                  width={word.width + 16}
                  height={word.height + 8}
                  rx={10}
                  fill="none"
                  stroke="var(--lq-accent)"
                  strokeWidth={3}
                  className="opacity-0 group-focus-within:opacity-100"
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="font-lq font-extrabold"
                  style={{ fontSize: word.fontSize, fill: word.rank === 0 ? "var(--lq-fg)" : `var(--lq-answer-${tone})` }}
                >
                  {word.text}
                </text>
                <text
                  y={word.height / 2 + 14}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="font-lq-mono opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  style={{ fontSize: Math.max(16, word.fontSize * 0.32), fill: "var(--lq-fg-muted)" }}
                >
                  ×{format.format(word.n)}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        {t("quizPresent.cloud.label")}
        <ol>
          {sorted.map((word) => (
            <li key={word.key}>{t("quizPresent.cloud.wordCount", { word: word.text, count: format.format(word.n) })}</li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
