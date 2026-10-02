import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

// pointer-coarse:text-base — iOS Safari zooms the page into any focused field under 16px.
const control =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle pointer-coarse:text-base " +
  "transition-[border-color,box-shadow] duration-150 ease-out hover:border-fg-subtle " +
  "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle " +
  "aria-invalid:border-danger aria-invalid:focus:ring-danger/25";

export const inputClassName = cn(control, "h-10");
export const textareaClassName = cn(control, "min-h-24 py-2 leading-relaxed");
export const selectClassName = cn(control, "select-chevron h-10");
/** Compact variants (dense grids such as PBQ tables and bucket cards). */
export const inputSmClassName = cn(control, "h-9");
export const selectSmClassName = cn(control, "select-chevron h-9");

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return <input ref={ref} {...props} className={cn(inputClassName, className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref
) {
  return <select ref={ref} {...props} className={cn(selectClassName, className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref
) {
  return <textarea ref={ref} {...props} className={cn(textareaClassName, className)} />;
});

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: ReactNode;
}

/** Native checkbox + label (the whole row is the hit target). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, ...props },
  ref
) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-10 cursor-pointer items-start gap-3 rounded-md py-2 text-sm text-fg has-disabled:cursor-not-allowed has-disabled:text-fg-subtle",
        className
      )}
    >
      <input
        ref={ref}
        id={id}
        type="checkbox"
        {...props}
        className="mt-0.5 size-4 shrink-0 cursor-[inherit] rounded-sm accent-primary"
      />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {description ? <span className="text-[0.8125rem] text-fg-muted">{description}</span> : null}
      </span>
    </label>
  );
});
