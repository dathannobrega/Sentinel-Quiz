import type { ReactNode } from "react";

import { Disclosure } from "@/components/ui/disclosure";
import { CheckIcon } from "@/components/ui/icons";
import { getServerTranslator } from "@/lib/i18n/server";

import { LandingAuthCta } from "@/features/marketing/components/landing-auth-cta";
import { LandingPreview } from "@/features/marketing/components/landing-preview";

function LandingSection({
  id,
  titleId,
  title,
  subtitle,
  children
}: {
  id?: string;
  titleId: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={titleId} className="grid scroll-mt-8 gap-8 border-t border-line pt-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
      <header className="flex flex-col gap-2">
        <h2 id={titleId} className="text-xl font-semibold tracking-[-0.01em] text-fg">
          {title}
        </h2>
        <p className="text-[0.9375rem] leading-relaxed text-fg-muted">{subtitle}</p>
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Server-rendered marketing page: content ships in the initial HTML, no /auth/me gate. */
export async function LandingPageShell() {
  const { t, messages } = await getServerTranslator();
  const marketing = messages.marketing;

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-16 px-4 pt-10 pb-24 sm:px-6 lg:gap-20 lg:px-10 lg:pt-16">
      <section className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16" aria-labelledby="landing-title">
        <div className="flex flex-col gap-6">
          <p className="text-sm font-medium text-primary">{t("marketing.hero.eyebrow")}</p>
          <h1
            id="landing-title"
            className="max-w-[20ch] text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-fg sm:text-5xl lg:text-[3.5rem]"
          >
            {t("marketing.hero.title")}
          </h1>
          <p className="max-w-prose text-[1.0625rem] leading-relaxed text-fg-muted">{t("marketing.hero.lead")}</p>
          <LandingAuthCta variant="hero" />
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-muted">
            {marketing.hero.chips.map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5">
                <CheckIcon className="text-success" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <LandingPreview />
      </section>

      <LandingSection id="como-funciona" titleId="landing-how-title" title={t("marketing.howItWorks.title")} subtitle={t("marketing.howItWorks.subtitle")}>
        <ol className="grid gap-8 md:grid-cols-3">
          {marketing.howItWorks.steps.map((item) => (
            <li key={item.title} className="flex flex-col gap-2">
              <p className="font-semibold text-fg">{item.title}</p>
              <p className="text-[0.9375rem] leading-relaxed text-fg-muted">{item.description}</p>
            </li>
          ))}
        </ol>
      </LandingSection>

      <LandingSection titleId="landing-why-title" title={t("marketing.whyItWorks.title")} subtitle={t("marketing.whyItWorks.subtitle")}>
        <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          {marketing.whyItWorks.items.map(([title, copy]) => (
            <li key={title} className="flex flex-col gap-1.5">
              <p className="font-medium text-fg">{title}</p>
              <p className="text-sm leading-relaxed text-fg-muted">{copy}</p>
            </li>
          ))}
        </ul>
      </LandingSection>

      <LandingSection id="produto" titleId="landing-preview-title" title={t("marketing.preview.title")} subtitle={t("marketing.preview.subtitle")}>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {marketing.preview.cards.map((item) => (
            <li key={item.title} className="grid gap-1 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
              <p className="font-medium text-fg">{item.title}</p>
              <div className="flex flex-col gap-1">
                <p className="text-[0.9375rem] text-fg">{item.subtitle}</p>
                <p className="text-[0.8125rem] text-fg-subtle">{item.chips.join(" · ")}</p>
              </div>
            </li>
          ))}
        </ul>
      </LandingSection>

      <LandingSection titleId="landing-offer-title" title={t("marketing.offer.title")} subtitle={t("marketing.offer.subtitle")}>
        <ul className="grid gap-6 sm:grid-cols-2">
          {marketing.offer.items.map(([title, description]) => (
            <li key={title} className="flex flex-col gap-1.5">
              <p className="font-medium text-fg">{title}</p>
              <p className="text-sm leading-relaxed text-fg-muted">{description}</p>
            </li>
          ))}
        </ul>
      </LandingSection>

      <LandingSection id="faq" titleId="landing-faq-title" title={t("marketing.faq.title")} subtitle={t("marketing.faq.subtitle")}>
        <div className="border-t border-line">
          {marketing.faq.items.map(([question, answer]) => (
            <Disclosure key={question} variant="plain" summary={question}>
              <p className="max-w-prose text-[0.9375rem] leading-relaxed text-fg-muted">{answer}</p>
            </Disclosure>
          ))}
        </div>
      </LandingSection>

      <LandingSection titleId="landing-trust-title" title={t("marketing.trust.title")} subtitle={t("marketing.trust.subtitle")}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {marketing.trust.chips.map((item) => (
            <li key={item} className="inline-flex items-center gap-2 text-[0.9375rem] text-fg">
              <CheckIcon className="text-success" />
              {item}
            </li>
          ))}
        </ul>
      </LandingSection>

      <section aria-labelledby="landing-cta-title" className="flex flex-col items-start gap-5 border-t border-line pt-12">
        <p className="text-sm font-medium text-primary">{t("marketing.cta.eyebrow")}</p>
        <h2 id="landing-cta-title" className="max-w-[24ch] text-3xl leading-tight font-semibold tracking-[-0.02em] text-balance text-fg sm:text-4xl">
          {t("marketing.cta.title")}
        </h2>
        <LandingAuthCta variant="footer" />
      </section>
    </main>
  );
}
