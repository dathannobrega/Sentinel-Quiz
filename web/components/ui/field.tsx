"use client";

import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";

import { useOptionalI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils/cn";

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  hintMode?: "inline" | "tooltip" | "none";
  children: ReactNode;
}

type DescribableProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

function mergeIds(...values: Array<string | null | undefined>): string | undefined {
  const ids = values
    .flatMap((value) => String(value || "").split(/\s+/))
    .filter(Boolean);
  return ids.length ? Array.from(new Set(ids)).join(" ") : undefined;
}

/**
 * Label + control wrapper. Wires `aria-describedby` (hint and error) and `aria-invalid` into the
 * single child control, so screen readers announce hints/errors without relying on `title`.
 */
export function Field({ label, htmlFor, hint, error, hintMode = "tooltip", children }: FieldProps) {
  const i18n = useOptionalI18n();
  const [isHintOpen, setIsHintOpen] = useState(false);
  const hasHint = Boolean(hint) && hintMode !== "none";
  const hintId = hasHint ? `${htmlFor}-hint` : null;
  const errorId = error ? `${htmlFor}-error` : null;
  const hintVisible = hasHint && (hintMode === "inline" || isHintOpen) && !error;

  const onlyChild = Children.count(children) === 1 ? Children.only(children) : null;
  const control =
    onlyChild && isValidElement(onlyChild)
      ? cloneElement(onlyChild as ReactElement<DescribableProps>, {
          "aria-describedby": mergeIds(
            (onlyChild as ReactElement<DescribableProps>).props["aria-describedby"],
            hintId,
            errorId
          ),
          "aria-invalid": error ? true : (onlyChild as ReactElement<DescribableProps>).props["aria-invalid"]
        })
      : children;

  return (
    <div className="sq-field">
      <div className="sq-field-label-row">
        <label className="sq-field-label" htmlFor={htmlFor}>
          {label}
        </label>
        {hasHint && hintMode === "tooltip" ? (
          <button
            type="button"
            className="sq-field-hint-button"
            aria-label={i18n ? i18n.t("system.field.hintLabel", { label }) : label}
            aria-expanded={isHintOpen}
            aria-controls={hintId || undefined}
            title={hint}
            onClick={() => setIsHintOpen((current) => !current)}
          >
            ?
          </button>
        ) : null}
      </div>
      {control}
      {error ? (
        <span id={errorId || undefined} className="sq-field-error" role="alert">
          {error}
        </span>
      ) : null}
      {hasHint ? (
        <span id={hintId || undefined} className={cn(hintVisible ? "sq-field-hint" : "sq-visually-hidden")}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
