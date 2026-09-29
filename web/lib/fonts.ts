import { IBM_Plex_Mono, Schibsted_Grotesk, Source_Serif_4 } from "next/font/google";

/**
 * Self-hosted at build time (no runtime request to Google, no render-blocking @import).
 * - UI: Schibsted Grotesk — sturdy grotesk for navigation, labels and headings.
 * - Reading: Source Serif 4 — question prompts and long explanations, set like a printed exam.
 * - Code: IBM Plex Mono — timers, option keys, logs and exhibits.
 */
export const uiFont = Schibsted_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap"
});

export const readingFont = Source_Serif_4({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-reading",
  display: "swap"
});

export const codeFont = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-code",
  display: "swap"
});

export const fontVariables = `${uiFont.variable} ${readingFont.variable} ${codeFont.variable}`;
