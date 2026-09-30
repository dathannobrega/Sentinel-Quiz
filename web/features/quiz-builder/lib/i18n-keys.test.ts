import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getMessageValue, getMessages } from "@/lib/i18n/core";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIRS = ["features/quiz-builder", "features/quiz-reports", "components/navigation"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Static keys only: t("quizBuilder.x.y") / t(`quizReports.x`) without interpolation. */
function usedKeys(): string[] {
  const keys = new Set<string>();
  for (const dir of DIRS) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\(\s*["`]((?:quizBuilder|quizReports)\.[\w.-]+)["`]/g)) {
        keys.add(match[1] as string);
      }
    }
  }
  return Array.from(keys).sort();
}

describe("quiz builder / reports i18n keys", () => {
  it("every static key used in the features exists in both locales", () => {
    const keys = usedKeys();
    expect(keys.length).toBeGreaterThan(50);
    for (const locale of ["pt-BR", "en-US"] as const) {
      const messages = getMessages(locale);
      const missing = keys.filter((key) => typeof getMessageValue(messages, key) !== "string");
      expect(missing, locale).toEqual([]);
    }
  });
});
