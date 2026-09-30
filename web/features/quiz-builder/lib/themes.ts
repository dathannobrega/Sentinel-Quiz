import type { CSSProperties } from "react";

import type { LiveThemeKey } from "@/types/api";

/**
 * Editor-side approximation of the stage themes (PLANO §9.3). The full theme lives in
 * web/styles/live-themes.css under [data-lq-theme]; the preview wrapper sets data-lq-theme and
 * reads `var(--lq-*, <fallback>)`, so it picks the real tokens when present and these
 * values otherwise. Answer colours never use red/green (reserved for correct/incorrect).
 */
export interface ThemeSwatch {
  key: LiveThemeKey;
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  answers: [string, string, string, string, string, string];
  onAnswer: string;
  font: "sans" | "mono";
  /** Decorative pattern for the preview background. */
  pattern: "dots" | "scanlines" | "hex" | "aurora" | "none";
}

export const LIVE_THEMES: Record<LiveThemeKey, ThemeSwatch> = {
  sentinel: {
    key: "sentinel",
    bg: "#0f1115",
    surface: "#1a1e27",
    fg: "#e8eaef",
    muted: "#b4bac6",
    accent: "#8ea2ff",
    answers: ["#4f7cff", "#f0b35a", "#e879f9", "#22d3ee", "#a78bfa", "#cbd5e1"],
    onAnswer: "#0b0d12",
    font: "sans",
    pattern: "dots"
  },
  terminal: {
    key: "terminal",
    bg: "#070b08",
    surface: "#0e1510",
    fg: "#c8ffd4",
    muted: "#8fbf9a",
    accent: "#39ff88",
    answers: ["#ffb000", "#22d3ee", "#e5e7eb", "#ff5fd2", "#60a5fa", "#b388ff"],
    onAnswer: "#070b08",
    font: "mono",
    pattern: "scanlines"
  },
  neon_soc: {
    key: "neon_soc",
    bg: "#070a1a",
    surface: "#0f1430",
    fg: "#e6f1ff",
    muted: "#a9b8d6",
    accent: "#22d3ee",
    answers: ["#22d3ee", "#f472b6", "#fbbf24", "#818cf8", "#c084fc", "#e2e8f0"],
    onAnswer: "#070a1a",
    font: "sans",
    pattern: "hex"
  },
  aurora: {
    key: "aurora",
    bg: "#0b1026",
    surface: "#151b3a",
    fg: "#f5f7ff",
    muted: "#c3c8e6",
    accent: "#a78bfa",
    answers: ["#a78bfa", "#f472b6", "#38bdf8", "#fbbf24", "#c4b5fd", "#e2e8f0"],
    onAnswer: "#0b1026",
    font: "sans",
    pattern: "aurora"
  },
  high_contrast: {
    key: "high_contrast",
    bg: "#000000",
    surface: "#000000",
    fg: "#ffffff",
    muted: "#ffffff",
    accent: "#ffff00",
    answers: ["#ffff00", "#00ffff", "#ff80ff", "#ffffff", "#ffb000", "#9ecbff"],
    onAnswer: "#000000",
    font: "sans",
    pattern: "none"
  }
};

export const THEME_ORDER: LiveThemeKey[] = ["sentinel", "terminal", "neon_soc", "aurora", "high_contrast"];

export function resolveTheme(key: string | null | undefined): ThemeSwatch {
  return LIVE_THEMES[(key as LiveThemeKey) ?? "sentinel"] ?? LIVE_THEMES.sentinel;
}

/** Shapes paired with letters so answers never depend on colour alone. */
export const ANSWER_SHAPES = ["▲", "◆", "●", "■", "⬟", "✚"] as const;
export const ANSWER_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

const PATTERNS: Record<ThemeSwatch["pattern"], (theme: ThemeSwatch) => string> = {
  dots: (theme) => `radial-gradient(${theme.accent}22 1px, transparent 1.4px) 0 0 / 18px 18px`,
  scanlines: () => "repeating-linear-gradient(0deg, #ffffff08 0 1px, transparent 1px 3px)",
  hex: (theme) =>
    `radial-gradient(circle at 20% 0%, ${theme.accent}26, transparent 55%), radial-gradient(${theme.accent}1a 1px, transparent 1.5px) 0 0 / 22px 22px`,
  aurora: () =>
    "radial-gradient(60% 80% at 10% 10%, #a78bfa40, transparent 60%), radial-gradient(50% 70% at 90% 20%, #38bdf833, transparent 60%), radial-gradient(60% 60% at 50% 100%, #f472b62b, transparent 60%)",
  none: () => "none"
};

/**
 * CSS variables for a themed stage. `--qb-*` resolve to the shared `--lq-*` stage tokens when the
 * live theme stylesheet is loaded, falling back to the approximations above.
 */
export function themeStageStyle(key: string | null | undefined): CSSProperties {
  const theme = resolveTheme(key);
  const style: Record<string, string> = {
    "--qb-bg": `var(--lq-bg, ${theme.bg})`,
    "--qb-surface": `var(--lq-surface, ${theme.surface})`,
    "--qb-fg": `var(--lq-fg, ${theme.fg})`,
    "--qb-muted": `var(--lq-fg-muted, ${theme.muted})`,
    "--qb-accent": `var(--lq-accent, ${theme.accent})`,
    "--qb-pattern": PATTERNS[theme.pattern](theme),
    "--qb-font": theme.font === "mono" ? "var(--font-mono)" : "var(--font-sans)"
  };
  theme.answers.forEach((color, index) => {
    style[`--qb-answer-${index + 1}`] = `var(--lq-answer-${index + 1}, ${color})`;
    style[`--qb-on-answer-${index + 1}`] = `var(--lq-on-answer-${index + 1}, ${theme.onAnswer})`;
  });
  return style as CSSProperties;
}
