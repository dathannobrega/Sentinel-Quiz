"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { m } from "motion/react";

import { LiveMotionProvider, springs } from "@/components/quiz-kit/motion";
import { LiveThemeRoot } from "@/features/quiz-live/components/live-chrome";
import { LqButton, LqError, lqCardClass } from "@/features/quiz-live/components/lq-ui";
import { getRoom, toJoinErrorCode } from "@/features/quiz-live/lib/live-fetch";
import { isValidJoinCode, JOIN_CODE_LENGTH, normalizeJoinCode } from "@/features/quiz-live/lib/protocol";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

/**
 * Segmented PIN input backed by ONE real input (screen readers and autofill see a normal text field;
 * paste of "482 913" or of a full join link works). The six boxes are presentation only.
 */
export function PinInput({
  value,
  onChange,
  invalid,
  describedBy,
  label,
  autoFocus
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  label: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const digits = value.padEnd(JOIN_CODE_LENGTH, " ").slice(0, JOIN_CODE_LENGTH).split("");
  const active = Math.min(value.length, JOIN_CODE_LENGTH - 1);

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(event) => onChange(normalizeJoinCode(event.target.value))}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (pasted) {
            event.preventDefault();
            onChange(normalizeJoinCode(pasted));
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        enterKeyHint="go"
        autoFocus={autoFocus}
        maxLength={64}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="absolute inset-0 z-10 size-full cursor-text opacity-0"
      />
      <div aria-hidden="true" className="flex items-center justify-center gap-2 sm:gap-3">
        {digits.map((digit, index) => {
          const filled = digit.trim() !== "";
          const isActive = focused && index === active && value.length < JOIN_CODE_LENGTH;
          return (
            <span key={index} className={cn("flex items-center", index === 3 && "ml-2 sm:ml-4")}>
              <m.span
                className={cn(
                  "grid h-16 w-12 place-items-center rounded-[calc(var(--lq-radius)*0.6)] border-2 bg-lq-surface font-lq-mono text-3xl font-medium text-lq-fg sm:h-20 sm:w-14 sm:text-4xl",
                  invalid ? "border-lq-danger" : isActive ? "border-lq-accent" : filled ? "border-lq-fg-muted" : "border-lq-line"
                )}
                animate={filled ? { scale: [0.86, 1.08, 1] } : { scale: 1 }}
                transition={springs.snappy}
              >
                {filled ? digit : isActive ? <span className="h-8 w-0.5 animate-pulse bg-lq-accent" /> : null}
              </m.span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** `/j`: big PIN entry. Looks the room up before navigating so errors show right here. */
export function CodeEntry({ initialCode = "" }: { initialCode?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState(() => normalizeJoinCode(initialCode));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  const hintId = useId();
  const lastAutoSubmit = useRef("");

  async function submit(target: string) {
    if (!isValidJoinCode(target)) {
      setError(t("quizPlay.entry.invalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const room = await getRoom(target);
      if (room.status === "finished") {
        setError(t("quizPlay.errors.session_finished"));
        return;
      }
      router.push(`/j/${target}`);
    } catch (caught) {
      setError(t(`quizPlay.errors.${toJoinErrorCode(caught)}`));
    } finally {
      setBusy(false);
    }
  }

  // Auto-submit once the 6th digit lands (paste or typing).
  useEffect(() => {
    if (code.length === JOIN_CODE_LENGTH && isValidJoinCode(code) && lastAutoSubmit.current !== code) {
      lastAutoSubmit.current = code;
      void submit(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    lastAutoSubmit.current = code;
    void submit(code);
  }

  return (
    <LiveMotionProvider>
      <LiveThemeRoot theme="sentinel" className="min-h-dvh" particles>
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-10">
          <m.div initial={{ y: 16 }} animate={{ y: 0 }} transition={springs.gentle} className={cn(lqCardClass, "flex flex-col gap-6 px-5 py-8 sm:px-8")}>
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="font-lq-mono text-xs font-medium tracking-[0.2em] text-lq-accent uppercase">{t("quizPlay.brand")}</p>
              <h1 className="font-lq text-3xl font-extrabold text-lq-fg sm:text-4xl">{t("quizPlay.entry.title")}</h1>
              <p className="text-lq-fg-muted">{t("quizPlay.entry.subtitle")}</p>
            </div>
            <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
              <PinInput
                value={code}
                onChange={(next) => {
                  setCode(next);
                  setError(null);
                }}
                invalid={Boolean(error)}
                describedBy={error ? `${errorId} ${hintId}` : hintId}
                label={t("quizPlay.entry.label")}
                autoFocus
              />
              <p id={hintId} className="text-center text-sm text-lq-fg-muted">
                {t("quizPlay.entry.pasteHint")}
              </p>
              {error ? <LqError id={errorId}>{error}</LqError> : null}
              <LqButton type="submit" size="lg" busy={busy} busyLabel={t("quizPlay.entry.checking")} disabled={code.length < JOIN_CODE_LENGTH}>
                {t("quizPlay.entry.submit")}
              </LqButton>
            </form>
          </m.div>
        </main>
      </LiveThemeRoot>
    </LiveMotionProvider>
  );
}
