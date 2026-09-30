"use client";

import { useId, useRef, type KeyboardEvent } from "react";

import { CheckIcon } from "@/components/ui/icons";
import { LIVE_THEMES, THEME_ORDER, themeStageStyle } from "@/features/quiz-builder/lib/themes";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveThemeKey } from "@/types/api";

/** Miniature stage in the theme's colours: background pattern, a prompt bar and 4 answer tiles. */
export function ThemeSwatch({ themeKey, className }: { themeKey: LiveThemeKey | string; className?: string }) {
  const theme = LIVE_THEMES[themeKey as LiveThemeKey] ?? LIVE_THEMES.sentinel;
  return (
    <div
      aria-hidden="true"
      data-lq-theme={theme.key}
      style={themeStageStyle(theme.key)}
      className={cn(
        "relative isolate flex aspect-video w-full flex-col justify-between overflow-hidden rounded-md p-[7%]",
        "[background:var(--qb-pattern),var(--qb-bg)]",
        theme.key === "high_contrast" && "outline outline-2 -outline-offset-2 outline-[var(--qb-accent)]",
        className
      )}
    >
      <div className="flex flex-col gap-[6%]">
        <span className="block h-[0.55rem] w-4/5 rounded-full bg-[var(--qb-fg)] opacity-90" />
        <span className="block h-[0.4rem] w-1/2 rounded-full bg-[var(--qb-muted)] opacity-70" />
      </div>
      <div className="grid grid-cols-2 gap-[5%]">
        {[1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className="block h-[0.9rem] rounded-[3px]"
            style={{ background: `var(--qb-answer-${index})` }}
          />
        ))}
      </div>
    </div>
  );
}

interface ThemePickerProps {
  value: LiveThemeKey;
  onChange: (value: LiveThemeKey) => void;
  themes?: LiveThemeKey[];
  label: string;
  disabled?: boolean;
  columns?: 2 | 3 | 5;
}

/** Radio group of theme swatches (roving tabindex, arrow keys). Name + check mark carry the state. */
export function ThemePicker({ value, onChange, themes, label, disabled = false, columns = 3 }: ThemePickerProps) {
  const { t } = useI18n();
  const labelId = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const list = (themes?.length ? THEME_ORDER.filter((key) => themes.includes(key)) : THEME_ORDER).filter(
    (key) => key in LIVE_THEMES
  );

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!delta) {
      return;
    }
    event.preventDefault();
    const next = list[(index + delta + list.length) % list.length];
    if (next) {
      onChange(next);
      refs.current[next]?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-[0.8125rem] font-medium text-fg">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className={cn(
          "grid gap-3",
          columns === 2 && "grid-cols-2",
          columns === 3 && "grid-cols-2 sm:grid-cols-3",
          columns === 5 && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
        )}
      >
        {list.map((key, index) => {
          const selected = key === value;
          return (
            <button
              key={key}
              ref={(node) => {
                refs.current[key] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-describedby={`${labelId}-${key}`}
              tabIndex={selected || (!list.includes(value) && index === 0) ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(key)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "focus-ring group flex flex-col gap-2 rounded-lg border p-2 text-left transition-[border-color,box-shadow] duration-150",
                selected ? "border-primary shadow-[0_0_0_1px_var(--color-primary)]" : "border-line hover:border-line-strong",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              <ThemeSwatch themeKey={key} className="motion-safe:transition-transform motion-safe:duration-200 group-hover:motion-safe:scale-[1.02]" />
              <span className="flex items-center gap-1.5 px-0.5 text-[0.8125rem] font-medium text-fg">
                {selected ? <CheckIcon className="text-primary" /> : null}
                {t(`quizBuilder.themes.${key}.name`)}
              </span>
              <span id={`${labelId}-${key}`} className="sr-only">
                {t(`quizBuilder.themes.${key}.description`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
