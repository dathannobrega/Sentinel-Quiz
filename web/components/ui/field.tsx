import type { ReactNode } from "react";

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  hintMode?: "inline" | "tooltip" | "none";
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, hintMode = "tooltip", children }: FieldProps) {
  const hintId = hint && hintMode === "inline" ? `${htmlFor}-hint` : null;
  const errorId = error ? `${htmlFor}-error` : null;

  return (
    <div className="sq-field">
      <div className="sq-field-label-row">
        <label className="sq-field-label" htmlFor={htmlFor}>
          {label}
        </label>
        {!error && hint && hintMode === "tooltip" ? (
          <button
            type="button"
            className="sq-field-hint-button"
            aria-label={hint}
            title={hint}
          >
            ?
          </button>
        ) : null}
      </div>
      {children}
      {error ? (
        <span id={errorId || undefined} className="sq-field-error">
          {error}
        </span>
      ) : null}
      {!error && hint && hintMode === "inline" ? (
        <span id={hintId || undefined} className="sq-field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
