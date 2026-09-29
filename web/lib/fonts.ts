import localFont from "next/font/local";

/**
 * Fonts come from versioned Fontsource packages (SIL OFL 1.1) and are served by the app itself:
 * builds need no request to Google Fonts (which fails in sandboxed CI) and pages make none either.
 * The `latin` subset covers pt-BR and en-US (Latin-1 includes ã, ç, é...).
 * - UI: Schibsted Grotesk (variable weight) — navigation, labels, headings.
 * - Reading: Source Serif 4 (variable weight) — question prompts and explanations.
 * - Code: IBM Plex Mono — timers, option keys, logs and exhibits.
 */
export const uiFont = localFont({
  src: "../node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2",
  weight: "400 900",
  style: "normal",
  variable: "--font-ui",
  display: "swap"
});

export const readingFont = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2", weight: "200 900", style: "normal" },
    { path: "../node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2", weight: "200 900", style: "italic" }
  ],
  variable: "--font-reading",
  display: "swap"
});

export const codeFont = localFont({
  src: [
    { path: "../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" }
  ],
  variable: "--font-code",
  display: "swap"
});

export const fontVariables = `${uiFont.variable} ${readingFont.variable} ${codeFont.variable}`;
