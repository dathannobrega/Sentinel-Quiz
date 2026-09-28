import { describe, expect, it } from "vitest";

import { enUSMessages } from "@/lib/i18n/locales/en-us";
import { ptBRMessages } from "@/lib/i18n/locales/pt-br";

import {
  deactivatedReasonKey,
  flagFilterValue,
  ingestSummaryLines,
  qualityStatusKey,
  qualityTone
} from "@/features/admin/utils/question-draft";

function lookup(catalog: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
}

/** Fake translator that records keys and fails on keys missing from either catalog. */
function recordingTranslator() {
  const keys: string[] = [];
  const t = (key: string, values?: Record<string, string | number>) => {
    keys.push(key);
    expect(typeof lookup(ptBRMessages, key), `pt-BR ${key}`).toBe("string");
    expect(typeof lookup(enUSMessages, key), `en-US ${key}`).toBe("string");
    return `${key}${values ? JSON.stringify(values) : ""}`;
  };
  return { t, keys };
}

describe("admin quality badges", () => {
  it("labels placeholder rationales as a warning", () => {
    expect(qualityStatusKey("placeholder")).toBe("admin.quality.placeholder");
    expect(qualityTone("placeholder")).toBe("warning");
    expect(qualityTone("ok")).toBe("good");
    expect(qualityStatusKey("missing")).toBe("admin.quality.pending");
    for (const status of ["ok", "provided", "missing", "unverified", "placeholder"]) {
      const key = qualityStatusKey(status);
      expect(key && typeof lookup(ptBRMessages, key)).toBe("string");
      expect(key && typeof lookup(enUSMessages, key)).toBe("string");
    }
  });
});

describe("admin question filters", () => {
  it("maps flag filters to query booleans", () => {
    expect(flagFilterValue("any")).toBeUndefined();
    expect(flagFilterValue("yes")).toBe(true);
    expect(flagFilterValue("no")).toBe(false);
  });

  it("describes deactivation reasons with catalog keys", () => {
    const { t } = recordingTranslator();
    for (const reason of ["deleted", "removed_from_source", null, "other"]) {
      t(deactivatedReasonKey(reason));
    }
  });
});

describe("ingest summary", () => {
  it("shows files/questions and only non-zero lifecycle counters", () => {
    const { t, keys } = recordingTranslator();
    const lines = ingestSummaryLines(
      {
        imported: 2,
        skipped: 1,
        errors: ["bad.json: boom"],
        questions_imported: 40,
        skipped_deleted: 3,
        skipped_editorial: 0,
        reactivated: 0,
        deactivated: 5,
        domain_weights_updated: 13,
        study_modules: 0
      },
      t
    );
    expect(keys).toEqual([
      "admin.ingest.files",
      "admin.ingest.questions",
      "admin.ingest.deactivated",
      "admin.ingest.skippedDeleted",
      "admin.ingest.domainWeights"
    ]);
    expect(lines[0]).toContain('"errors":1');
    expect(lines[2]).toContain('"count":5');
  });

  it("tolerates a legacy response without the lifecycle keys", () => {
    const { t, keys } = recordingTranslator();
    expect(ingestSummaryLines({ imported: 0, skipped: 0, errors: [] }, t)).toHaveLength(2);
    expect(keys).toEqual(["admin.ingest.files", "admin.ingest.questions"]);
  });
});
