"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LqButton, LqError, LqInput } from "@/features/quiz-live/components/lq-ui";
import { accessWithReturnCode, toAccessErrorCode } from "@/features/quiz-live/lib/live-fetch";
import { useI18n } from "@/lib/i18n";
import type { LiveJoinResult } from "@/types/api/live";

/**
 * Name + return code → a fresh participant token (POST /api/live/me/access). Used when the
 * token expired or was replaced, and after the session ended (join codes get reused, so the
 * session id comes from what this tab stored at join time).
 * `variant="live"` renders with the room theme (join card); `"app"` inside app dialogs.
 */
export function AccessForm({
  sessionId,
  defaultName = "",
  onAccess,
  autoFocus = true,
  variant = "app"
}: {
  sessionId: string;
  defaultName?: string;
  onAccess: (result: LiveJoinResult) => void;
  autoFocus?: boolean;
  variant?: "app" | "live";
}) {
  const { t } = useI18n();
  const baseId = useId();
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (autoFocus) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [autoFocus]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const displayName = name.trim();
    const returnCode = code.trim().toUpperCase();
    if (!displayName || returnCode.length < 4) {
      setError(t("quizPlay.access.required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onAccess(await accessWithReturnCode({ session_id: sessionId, display_name: displayName, return_code: returnCode }));
    } catch (caught) {
      setError(t(`quizPlay.access.errors.${toAccessErrorCode(caught)}`));
    } finally {
      setBusy(false);
    }
  }

  if (variant === "live") {
    return (
      <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-labelledby={`${baseId}-title`}>
        <div>
          <h2 ref={headingRef} id={`${baseId}-title`} tabIndex={-1} className="font-lq text-2xl font-extrabold text-lq-fg outline-none">
            {t("quizPlay.access.title")}
          </h2>
          <p className="text-sm text-lq-fg-muted">{t("quizPlay.access.subtitle")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${baseId}-name`} className="text-sm font-semibold text-lq-fg">
            {t("quizPlay.access.nameLabel")}
          </label>
          <LqInput id={`${baseId}-name`} value={name} maxLength={64} autoComplete="nickname" onChange={(event) => setName(event.target.value)} disabled={busy} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${baseId}-code`} className="text-sm font-semibold text-lq-fg">
            {t("quizPlay.access.codeLabel")}
          </label>
          <LqInput
            id={`${baseId}-code`}
            value={code}
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={t("quizPlay.access.codePlaceholder")}
            className="font-lq-mono tracking-[0.2em] uppercase"
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? `${baseId}-error` : undefined}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
          />
        </div>
        {error ? <LqError id={`${baseId}-error`}>{error}</LqError> : null}
        <LqButton type="submit" size="lg" busy={busy} busyLabel={t("quizPlay.access.submitting")}>
          {t("quizPlay.access.submit")}
        </LqButton>
      </form>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-labelledby={`${baseId}-title`}>
      <div>
        <h3 ref={headingRef} id={`${baseId}-title`} tabIndex={-1} className="text-base font-semibold text-fg outline-none">
          {t("quizPlay.access.title")}
        </h3>
        <p className="mt-1 text-sm text-fg-muted">{t("quizPlay.access.subtitle")}</p>
      </div>
      <Field label={t("quizPlay.access.nameLabel")} htmlFor={`${baseId}-name`} hintMode="none">
        <Input id={`${baseId}-name`} value={name} maxLength={64} autoComplete="nickname" onChange={(event) => setName(event.target.value)} disabled={busy} />
      </Field>
      <Field label={t("quizPlay.access.codeLabel")} htmlFor={`${baseId}-code`} hintMode="none">
        <Input
          id={`${baseId}-code`}
          value={code}
          maxLength={12}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={t("quizPlay.access.codePlaceholder")}
          className="font-mono tracking-[0.18em] uppercase"
          onChange={(event) => setCode(event.target.value)}
          disabled={busy}
        />
      </Field>
      {error ? <Alert tone="danger" role="alert" message={error} /> : null}
      <Button type="submit" busy={busy} busyLabel={t("quizPlay.access.submitting")} className="self-start">
        {t("quizPlay.access.submit")}
      </Button>
    </form>
  );
}
