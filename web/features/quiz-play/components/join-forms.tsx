"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { m } from "motion/react";

import { Avatar } from "@/components/quiz-kit/avatar";
import { springs } from "@/components/quiz-kit/motion";
import { LqButton, LqError, LqInput, lqButtonClass } from "@/features/quiz-live/components/lq-ui";
import {
  computeDeviceHash,
  isJoinWaiting,
  joinRoom,
  rejoinRoom,
  suggestName,
  toJoinErrorCode,
  type JoinErrorCode
} from "@/features/quiz-live/lib/live-fetch";
import { useI18n } from "@/lib/i18n";
import type { LiveJoinOutcome, LiveJoinRequest, LiveJoinResult, LiveJoinWaiting, LiveRoomInfo } from "@/types/api/live";
import { cn } from "@/lib/utils/cn";

export const NAME_MIN = 2;
export const NAME_MAX = 24;

/** Client-side name check mirroring the server rule (2–24 chars after trimming/collapsing spaces). */
export function validateDisplayName(raw: string): "short" | "long" | null {
  const name = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  const length = Array.from(name).length;
  if (length < NAME_MIN) {
    return "short";
  }
  if (length > NAME_MAX) {
    return "long";
  }
  return null;
}

function randomSeed(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type FieldError = { field: "name" | "consent" | "code" | "form"; message: string; code?: JoinErrorCode | string };

/**
 * Guest join: just a name (+ "suggest"), a short LGPD consent and an optional sign-in link.
 * Every join error code from the contract maps to friendly copy.
 */
export function GuestJoinForm({
  code,
  room,
  defaultName = "",
  onJoined,
  onWaiting,
  onWantRejoin,
  onOpenMyData,
  join,
  returnTo,
  labels,
  mapError
}: {
  code: string;
  room: Pick<LiveRoomInfo, "session_id" | "requires_login" | "consent_version">;
  defaultName?: string;
  onJoined: (result: LiveJoinResult) => void;
  /** 202 of the live join (Incremento 7): the person goes to the waiting room. */
  onWaiting?: (result: LiveJoinWaiting) => void;
  onWantRejoin: () => void;
  /** "Meus dados" (RF-650/RF-606) from the consent area. */
  onOpenMyData?: () => void;
  /** Alternative join endpoint with the same body/answer (challenges: POST /q/{slug}/join). */
  join?: (body: LiveJoinRequest) => Promise<LiveJoinOutcome>;
  /** Where the sign-in link returns to (default `/j/{code}`). */
  returnTo?: string;
  /** Copy overrides (a challenge has no projector and no room). */
  labels?: { subtitle?: string; submit?: string };
  /** Maps a join error to its message and field (default: the live room codes). */
  mapError?: (error: unknown) => { message: string; field: "name" | "consent" | "form"; code: string };
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState(defaultName);
  const [consent, setConsent] = useState(false);
  const [seed] = useState(randomSeed);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const nameHintId = useId();
  const nameErrorId = useId();
  const consentId = useId();
  const consentTextId = useId();
  const formErrorId = useId();

  useEffect(() => {
    if (error?.field === "name") {
      nameRef.current?.focus();
    } else if (error?.field === "consent") {
      consentRef.current?.focus();
    }
  }, [error]);

  async function onSuggest() {
    setSuggesting(true);
    try {
      const result = await suggestName(locale === "pt-BR" ? "pt-BR" : "en");
      setName(result.name);
      setError((current) => (current?.field === "name" ? null : current));
    } catch {
      setError({ field: "form", message: t("quizPlay.join.suggestFailed") });
    } finally {
      setSuggesting(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nameIssue = validateDisplayName(name);
    if (nameIssue) {
      setError({ field: "name", message: t(nameIssue === "short" ? "quizPlay.join.nameTooShort" : "quizPlay.join.nameTooLong") });
      return;
    }
    if (!consent) {
      setError({ field: "consent", message: t("quizPlay.join.consentRequired") });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const devH = await computeDeviceHash(room.session_id);
      const body: LiveJoinRequest = { display_name: name.trim(), consent: true, avatar_seed: seed, ...(devH ? { dev_h: devH } : {}) };
      const result = await (join ? join(body) : joinRoom(code, body));
      if (isJoinWaiting(result)) {
        if (!onWaiting) {
          // Challenges never queue: an unexpected 202 is a generic failure there.
          setError({ field: "form", message: t("quizPlay.errors.generic") });
          return;
        }
        onWaiting(result);
        return;
      }
      onJoined(result);
    } catch (caught) {
      if (mapError) {
        setError(mapError(caught));
        return;
      }
      const kind = toJoinErrorCode(caught);
      const field: FieldError["field"] = kind === "name_taken" || kind === "name_rejected" ? "name" : kind === "consent_required" ? "consent" : "form";
      setError({ field, message: t(`quizPlay.errors.${kind}`), code: kind });
    } finally {
      setBusy(false);
    }
  }

  const loginHref = `/login?next=${encodeURIComponent(returnTo ?? `/j/${code}`)}`;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <m.span key={seed} initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={springs.bouncy}>
          <Avatar seed={seed} size={64} />
        </m.span>
        <div className="min-w-0">
          <h2 className="font-lq text-2xl font-extrabold text-lq-fg">{t("quizPlay.join.title")}</h2>
          <p className="text-sm text-lq-fg-muted">{labels?.subtitle ?? t("quizPlay.join.subtitle")}</p>
        </div>
      </div>

      {room.requires_login ? (
        <div className="rounded-[calc(var(--lq-radius)*0.6)] border border-lq-line bg-lq-surface-2 p-4">
          <p className="font-semibold text-lq-fg">{t("quizPlay.join.loginOnlyTitle")}</p>
          <p className="text-sm text-lq-fg-muted">{t("quizPlay.join.loginOnlyText")}</p>
          <Link href={loginHref} className={cn(lqButtonClass("primary"), "mt-3 w-full")}>
            {t("quizPlay.join.signIn")}
          </Link>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor={nameId} className="text-sm font-semibold text-lq-fg">
          {t("quizPlay.join.nameLabel")}
        </label>
        <div className="flex gap-2">
          <LqInput
            ref={nameRef}
            id={nameId}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error?.field === "name") {
                setError(null);
              }
            }}
            placeholder={t("quizPlay.join.namePlaceholder")}
            autoComplete="nickname"
            autoCapitalize="words"
            enterKeyHint="go"
            maxLength={40}
            aria-invalid={error?.field === "name" || undefined}
            aria-describedby={error?.field === "name" ? `${nameErrorId} ${nameHintId}` : nameHintId}
            className="min-w-0 flex-1"
          />
          <LqButton variant="secondary" onClick={onSuggest} busy={suggesting} busyLabel={t("quizPlay.join.suggesting")} className="shrink-0">
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
            </svg>
            <span>{t("quizPlay.join.suggest")}</span>
          </LqButton>
        </div>
        <p id={nameHintId} className="text-xs text-lq-fg-muted">
          {t("quizPlay.join.nameHint")}
        </p>
        {error?.field === "name" ? (
          <LqError id={nameErrorId}>
            {error.message}
            {error.code === "name_taken" ? (
              <>
                {" "}
                <button type="button" onClick={onWantRejoin} className="focus-ring underline underline-offset-2">
                  {t("quizPlay.join.haveReturnCode")}
                </button>
              </>
            ) : null}
          </LqError>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={consentId} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[calc(var(--lq-radius)*0.5)] border border-lq-line bg-lq-surface-2 p-3">
          <input
            ref={consentRef}
            id={consentId}
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              if (error?.field === "consent") {
                setError(null);
              }
            }}
            aria-describedby={consentTextId}
            aria-invalid={error?.field === "consent" || undefined}
            className="mt-1 size-5 shrink-0 accent-[var(--lq-accent)]"
          />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-lq-fg">{t("quizPlay.join.consentLabel")}</span>
            <span id={consentTextId} className="text-xs leading-relaxed text-lq-fg-muted">
              {t("quizPlay.join.consentText", { version: room.consent_version })}
            </span>
          </span>
        </label>
        {error?.field === "consent" ? <LqError>{error.message}</LqError> : null}
        {onOpenMyData ? (
          <button
            type="button"
            onClick={onOpenMyData}
            className="focus-ring inline-flex min-h-11 items-center self-start rounded-md px-1 text-xs font-semibold text-lq-fg-muted underline underline-offset-4 hover:text-lq-fg"
          >
            {t("quizPlay.myData.link")}
          </button>
        ) : null}
      </div>

      {error?.field === "form" ? <LqError id={formErrorId}>{error.message}</LqError> : null}

      <LqButton type="submit" size="lg" busy={busy} busyLabel={t("quizPlay.join.submitting")}>
        {labels?.submit ?? t("quizPlay.join.submit")}
      </LqButton>

      <div className="flex flex-col items-center gap-1 text-sm">
        <button type="button" onClick={onWantRejoin} className="focus-ring min-h-11 rounded-md px-2 font-semibold text-lq-accent underline-offset-4 hover:underline">
          {t("quizPlay.join.haveReturnCode")}
        </button>
        {!room.requires_login ? (
          <Link href={loginHref} className="focus-ring inline-flex min-h-11 items-center rounded-md px-2 text-lq-fg-muted underline-offset-4 hover:text-lq-fg hover:underline">
            {t("quizPlay.join.signIn")}
          </Link>
        ) : null}
      </div>
    </form>
  );
}

/** Rejoin with name + return code (storage lost, other device, token expired). */
export function RejoinForm({
  code,
  notice,
  defaultName = "",
  onJoined,
  onBack
}: {
  code: string;
  notice?: string | null;
  defaultName?: string;
  onJoined: (result: LiveJoinResult) => void;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(defaultName);
  const [returnCode, setReturnCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const codeId = useId();
  const errorId = useId();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nameIssue = validateDisplayName(name);
    if (nameIssue) {
      setError(t(nameIssue === "short" ? "quizPlay.join.nameTooShort" : "quizPlay.join.nameTooLong"));
      return;
    }
    if (!returnCode.trim()) {
      setError(t("quizPlay.rejoin.codeRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onJoined(await rejoinRoom(code, { display_name: name.trim(), return_code: returnCode.trim().toUpperCase() }));
    } catch (caught) {
      setError(t(`quizPlay.errors.${toJoinErrorCode(caught)}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div>
        <h2 className="font-lq text-2xl font-extrabold text-lq-fg">{t("quizPlay.rejoin.title")}</h2>
        <p className="text-sm text-lq-fg-muted">{t("quizPlay.rejoin.subtitle")}</p>
      </div>
      {notice ? <p className="rounded-[calc(var(--lq-radius)*0.5)] bg-lq-warning px-3 py-2 text-sm font-semibold text-lq-on-warning">{notice}</p> : null}
      <div className="flex flex-col gap-2">
        <label htmlFor={nameId} className="text-sm font-semibold text-lq-fg">
          {t("quizPlay.join.nameLabel")}
        </label>
        <LqInput id={nameId} value={name} onChange={(event) => setName(event.target.value)} autoComplete="nickname" maxLength={40} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={codeId} className="text-sm font-semibold text-lq-fg">
          {t("quizPlay.rejoin.codeLabel")}
        </label>
        <LqInput
          id={codeId}
          value={returnCode}
          onChange={(event) => setReturnCode(event.target.value)}
          placeholder={t("quizPlay.rejoin.codePlaceholder")}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-lq-mono tracking-[0.2em] uppercase"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      {error ? <LqError id={errorId}>{error}</LqError> : null}
      <LqButton type="submit" size="lg" busy={busy} busyLabel={t("quizPlay.rejoin.submitting")}>
        {t("quizPlay.rejoin.submit")}
      </LqButton>
      {onBack ? (
        <button type="button" onClick={onBack} className="focus-ring min-h-11 self-center rounded-md px-2 text-sm font-semibold text-lq-accent underline-offset-4 hover:underline">
          {t("quizPlay.rejoin.back")}
        </button>
      ) : null}
    </form>
  );
}

/** Shown once after a guest join: the return code, big and copyable. */
export function ReturnCodeCard({ returnCode, onContinue }: { returnCode: string; onContinue: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(returnCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <m.span className="grid size-16 place-items-center rounded-full bg-lq-success text-lq-on-success" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={springs.bouncy}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-9">
          <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="lq-draw" style={{ animationDelay: "200ms" }} />
        </svg>
      </m.span>
      <h2 ref={headingRef} tabIndex={-1} className="font-lq text-3xl font-extrabold text-lq-fg outline-none">
        {t("quizPlay.returnCode.title")}
      </h2>
      <p className="max-w-sm text-lq-fg-muted">{t("quizPlay.returnCode.subtitle")}</p>
      <div className="flex w-full flex-col items-center gap-2 rounded-[var(--lq-radius)] border-2 border-dashed border-lq-accent bg-lq-surface-2 px-4 py-5">
        <span className="text-xs font-semibold tracking-[0.14em] text-lq-fg-muted uppercase">{t("quizPlay.returnCode.label")}</span>
        <span className="font-lq-mono text-4xl font-medium tracking-[0.18em] text-lq-fg select-all">{returnCode}</span>
        <LqButton variant="secondary" onClick={copy} aria-live="polite">
          {copied ? t("quizPlay.returnCode.copied") : t("quizPlay.returnCode.copy")}
        </LqButton>
      </div>
      <LqButton size="lg" className="w-full" onClick={onContinue}>
        {t("quizPlay.returnCode.continue")}
      </LqButton>
    </div>
  );
}
