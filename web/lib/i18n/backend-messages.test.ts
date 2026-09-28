import { describe, expect, it } from "vitest";

import { translateBackendMessage, translateReadinessBand } from "@/lib/i18n/backend-messages";
import { createTranslator, getMessages } from "@/lib/i18n/core";

const pt = createTranslator(getMessages("pt-BR")).t;
const en = createTranslator(getMessages("en-US")).t;

describe("backend message codes", () => {
  it("translates study plan task codes with params in both locales", () => {
    const params = { domain: "Asset Security", certification: "CISSP" };
    expect(translateBackendMessage(pt, "study_plan.risk_domain", params, "fallback", "title")).toBe(
      "Atacar risco de prova em Asset Security"
    );
    expect(translateBackendMessage(en, "study_plan.risk_domain", params, "fallback", "title")).toBe(
      "Tackle exam risk in Asset Security"
    );
    expect(translateBackendMessage(en, "study_plan.review_backlog", { count: 3 }, "x", "description")).toBe(
      "3 review(s) are overdue right now."
    );
  });

  it("translates readiness factor codes", () => {
    expect(translateBackendMessage(pt, "readiness.overdue_reviews", { count: 2 }, "fallback")).toBe(
      "2 revisão(ões) vencida(s) reduzem a sua projeção."
    );
  });

  it("falls back to the backend text for unknown codes or missing params", () => {
    expect(translateBackendMessage(en, "study_plan.brand_new_kind", {}, "Texto do backend", "title")).toBe(
      "Texto do backend"
    );
    expect(translateBackendMessage(en, "study_plan.risk_domain", {}, "Backend title", "title")).toBe("Backend title");
    expect(translateBackendMessage(en, null, {}, "No code")).toBe("No code");
  });

  it("localizes readiness bands, including insufficient data", () => {
    expect(translateReadinessBand(pt, "insufficient_data")).toBe("Dados insuficientes");
    expect(translateReadinessBand(en, "at_risk")).toBe("At risk");
    expect(translateReadinessBand(en, "custom_band")).toBe("custom_band");
  });
});
