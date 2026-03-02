import type { ReactNode } from "react";

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div>
      <label className="sq-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className="sq-field-error">{error}</span> : null}
      {!error && hint ? <span className="sq-field-hint">{hint}</span> : null}
    </div>
  );
}
