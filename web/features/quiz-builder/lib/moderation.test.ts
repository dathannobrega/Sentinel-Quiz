import { describe, expect, it } from "vitest";

import { describeFindingField, isFlagged, visibleFindings } from "@/features/quiz-builder/lib/moderation";

describe("publish moderation findings", () => {
  it("names each field the backend reports (0-based options become 1-based)", () => {
    expect(describeFindingField("prompt")).toEqual({ kind: "prompt", n: null });
    expect(describeFindingField("body")).toEqual({ kind: "body", n: null });
    expect(describeFindingField("option_0")).toEqual({ kind: "option", n: 1 });
    expect(describeFindingField("accepted_2")).toEqual({ kind: "accepted", n: 3 });
    expect(describeFindingField("weird")).toEqual({ kind: "other", n: null });
  });

  it("orders by position and caps the list", () => {
    const findings = [5, null, 1, 3].map((position, index) => ({ position, field: "prompt", term: `t${index}`, excerpt: "" }));
    const { shown, hidden } = visibleFindings(findings, 3);
    expect(shown.map((finding) => finding.position)).toEqual([null, 1, 3]);
    expect(hidden).toBe(1);
  });

  it("only flagged versions need the warning", () => {
    expect(isFlagged({ state: "flagged" })).toBe(true);
    expect(isFlagged({ state: "clear" })).toBe(false);
    expect(isFlagged(undefined)).toBe(false);
  });
});
