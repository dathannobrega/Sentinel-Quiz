#!/usr/bin/env node
/**
 * Generates the installable-app (PWA) icons from the brand mark: the filled answer-sheet bubble
 * (ring + dot) used by <BrandMark /> in components/navigation/app-shell.tsx.
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * Outputs (committed; re-run only when the mark or the palette changes):
 *   app/icon.svg              favicon for modern browsers (rounded tile, scales to any size)
 *   app/favicon.ico           16/32/48 px fallback (PNG-in-ICO) for /favicon.ico requests
 *   app/apple-icon.png        180 px, full-bleed (iOS masks it and rejects transparency)
 *   public/icons/icon-*.png   manifest "any" icons (rounded tile, transparent corners)
 *   public/icons/maskable-*.png manifest "maskable" icons (full-bleed, mark inside the 80% safe zone)
 *
 * Renders with Playwright's Chromium (a dev dependency). Set CHROMIUM_PATH to use another binary.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// styles/theme.css: --sq-primary (light) and --sq-primary-hover / --sq-primary-active.
const TILE_FROM = "#2f50d8";
const TILE_TO = "#182e8a";
const MARK = "#ffffff";

/**
 * The mark in a 24-unit box (ring r=11 with a 2-unit stroke, dot r=5), drawn at `markSize` px and
 * centred in a `size` px canvas.
 */
function markSvg(size, markSize) {
  const k = markSize / 24;
  const c = size / 2;
  return [
    `<circle cx="${c}" cy="${c}" r="${(11 * k).toFixed(2)}" fill="none" stroke="${MARK}" stroke-width="${(2 * k).toFixed(2)}"/>`,
    `<circle cx="${c}" cy="${c}" r="${(5 * k).toFixed(2)}" fill="${MARK}"/>`
  ].join("");
}

function tileSvg({ size, markRatio, radiusRatio }) {
  const radius = radiusRatio ? ` rx="${(size * radiusRatio).toFixed(2)}"` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="${TILE_FROM}"/><stop offset="1" stop-color="${TILE_TO}"/>`,
    `</linearGradient></defs>`,
    `<rect width="${size}" height="${size}"${radius} fill="url(#g)"/>`,
    markSvg(size, size * markRatio),
    `</svg>`
  ].join("");
}

// "any": rounded tile, generous mark. "maskable": full bleed, mark well inside the safe zone
// (a centred circle of 40% radius), so launchers can crop to circle/squircle/square.
const ANY = { markRatio: 0.6, radiusRatio: 0.22 };
const MASKABLE = { markRatio: 0.5, radiusRatio: 0 };
const APPLE = { markRatio: 0.56, radiusRatio: 0 };

const outputs = [
  { file: "public/icons/icon-192.png", size: 192, ...ANY },
  { file: "public/icons/icon-512.png", size: 512, ...ANY },
  { file: "public/icons/maskable-192.png", size: 192, ...MASKABLE },
  { file: "public/icons/maskable-512.png", size: 512, ...MASKABLE },
  { file: "app/apple-icon.png", size: 180, ...APPLE }
];
const ICO_SIZES = [16, 32, 48];

/** PNG-in-ICO container (supported by every browser that still asks for /favicon.ico). */
function icoFromPngs(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((png) => png.data)]);
}

async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  return page.locator("svg").screenshot({ omitBackground: true, type: "png" });
}

function write(relativePath, data) {
  const target = path.join(WEB_DIR, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, data);
  console.log(`wrote ${relativePath}`);
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, size, markRatio, radiusRatio } of outputs) {
    write(file, await render(page, tileSvg({ size, markRatio, radiusRatio }), size));
  }
  const icoPngs = [];
  for (const size of ICO_SIZES) {
    icoPngs.push({ size, data: await render(page, tileSvg({ size, ...ANY }), size) });
  }
  write("app/favicon.ico", icoFromPngs(icoPngs));
  // Vector favicon: the same tile, in a 64-unit box so the stroke stays crisp when scaled down.
  write("app/icon.svg", `${tileSvg({ size: 64, ...ANY })}\n`);
} finally {
  await browser.close();
}
