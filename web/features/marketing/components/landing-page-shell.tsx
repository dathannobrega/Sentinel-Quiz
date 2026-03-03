"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { fetchCurrentUser } from "@/lib/auth/session";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { useI18n } from "@/lib/i18n";

export function LandingPageShell() {
  const { t, getMessage } = useI18n();
  const router = useRouter();
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const heroChips = getMessage<string[]>("marketing.hero.chips");
  const howItWorksSteps = getMessage<Array<{ title: string; description: string }>>("marketing.howItWorks.steps");
  const whyItWorksItems = getMessage<Array<[string, string]>>("marketing.whyItWorks.items");
  const previewCards = getMessage<Array<{ title: string; subtitle: string; chips: string[] }>>("marketing.preview.cards");
  const offerItems = getMessage<Array<[string, string]>>("marketing.offer.items");
  const faqItems = getMessage<Array<[string, string]>>("marketing.faq.items");
  const trustChips = getMessage<string[]>("marketing.trust.chips");

  const syncSession = useEffectEvent(async () => {
    setIsCheckingSession(true);
    setLoadError(null);
    try {
      const user = await fetchCurrentUser();
      if (user) {
        startTransition(() => {
          router.replace("/dashboard");
        });
        return;
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("marketing.errors.checkSession"));
    } finally {
      setIsCheckingSession(false);
    }
  });

  useEffect(() => {
    void syncSession();
  }, [syncSession]);

  if (isCheckingSession) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <Skeleton height={280} />
          <Skeleton height={220} />
          <Skeleton height={240} />
        </div>
      </main>
    );
  }

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        {loadError ? (
          <StatusBanner
            tone="warning"
            title={t("marketing.errors.sessionUnavailable")}
            message={loadError}
          />
        ) : null}

        <section
          className="sq-card sq-hero"
          style={{
            border: "1px solid var(--sq-border)",
            borderRadius: "var(--sq-radius-lg)",
            background: "var(--sq-surface)",
            boxShadow: "var(--sq-shadow-lg)",
            padding: "var(--sq-space-6)"
          }}
        >
          <div className="sq-hero-copy">
            <div className="sq-eyebrow">{t("marketing.hero.eyebrow")}</div>
            <h1 className="sq-hero-title">{t("marketing.hero.title")}</h1>
            <p className="sq-hero-lead">{t("marketing.hero.lead")}</p>
            <div className="sq-actions">
              <Link href="/register" className="sq-button sq-button--md sq-button--primary">
                {t("common.actions.startFree")}
              </Link>
              <a href="#como-funciona" className="sq-button sq-button--md sq-button--ghost">
                {t("common.actions.seeDemo")}
              </a>
            </div>
            <div className="sq-chip-row">
              {heroChips.map((item) => (
                <span key={item} className="sq-chip">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="como-funciona" className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">{t("marketing.howItWorks.title")}</div>
              <div className="sq-list-meta">{t("marketing.howItWorks.subtitle")}</div>
            </div>
          </div>

          <div className="sq-grid-3">
            {howItWorksSteps.map((item) => (
              <div key={item.title} className="sq-list-item">
                <div className="sq-list-title">{item.title}</div>
                <div className="sq-list-meta">{item.description}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">{t("marketing.whyItWorks.title")}</div>
              <div className="sq-list-meta">{t("marketing.whyItWorks.subtitle")}</div>
            </div>
          </div>

          <div className="sq-grid-3">
            {whyItWorksItems.map(([title, copy]) => (
              <div key={title} className="sq-list-item">
                <div className="sq-list-title">{title}</div>
                <div className="sq-list-meta">{copy}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="produto" className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">{t("marketing.preview.title")}</div>
              <div className="sq-list-meta">{t("marketing.preview.subtitle")}</div>
            </div>
          </div>

          <div className="sq-grid-3">
            {previewCards.map((item) => (
              <Card key={item.title} title={item.title} subtitle={item.subtitle}>
                <div className="sq-chip-row">
                  {item.chips.map((chip) => (
                    <span key={`${item.title}-${chip}`} className="sq-chip">
                      {chip}
                    </span>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">{t("marketing.offer.title")}</div>
              <div className="sq-list-meta">{t("marketing.offer.subtitle")}</div>
            </div>
          </div>

          <div className="sq-grid-2">
            {offerItems.map(([title, description]) => (
              <div key={title} className="sq-list-item">
                <div className="sq-list-title">{title}</div>
                <div className="sq-list-meta">{description}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">{t("marketing.faq.title")}</div>
              <div className="sq-list-meta">{t("marketing.faq.subtitle")}</div>
            </div>
          </div>

          <div className="sq-list" role="list">
            {faqItems.map(([question, answer]) => (
              <div key={question} className="sq-list-item">
                <div className="sq-list-title">{question}</div>
                <div className="sq-list-meta">{answer}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">{t("marketing.trust.title")}</div>
              <div className="sq-list-meta">{t("marketing.trust.subtitle")}</div>
            </div>
          </div>

          <div className="sq-chip-row">
            {trustChips.map((item) => (
              <span key={item} className="sq-chip">
                {item}
              </span>
            ))}
          </div>
        </section>

        <section className="sq-card sq-hero" style={{ padding: "var(--sq-space-6)" }}>
          <div className="sq-hero-copy">
            <div className="sq-eyebrow">{t("marketing.cta.eyebrow")}</div>
            <h2 className="sq-hero-title">{t("marketing.cta.title")}</h2>
            <div className="sq-actions">
              <Link href="/register" className="sq-button sq-button--md sq-button--primary">
                {t("common.actions.startFree")}
              </Link>
              <Link href="/login" className="sq-button sq-button--md sq-button--ghost">
                {t("common.actions.alreadyHaveAccount")}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
