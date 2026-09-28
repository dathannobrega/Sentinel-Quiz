import { Card } from "@/components/ui/card";
import { getServerTranslator } from "@/lib/i18n/server";

import { LandingAuthCta } from "@/features/marketing/components/landing-auth-cta";

/** Server-rendered marketing page: content ships in the initial HTML, no /auth/me gate. */
export async function LandingPageShell() {
  const { t, messages } = await getServerTranslator();
  const marketing = messages.marketing;

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
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
            <LandingAuthCta variant="hero" />
            <div className="sq-chip-row">
              {marketing.hero.chips.map((item) => (
                <span key={item} className="sq-chip">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="como-funciona" className="sq-card" aria-labelledby="landing-how-title">
          <div className="sq-progress-head">
            <div>
              <h2 id="landing-how-title" className="sq-list-title">
                {t("marketing.howItWorks.title")}
              </h2>
              <div className="sq-list-meta">{t("marketing.howItWorks.subtitle")}</div>
            </div>
          </div>

          <div className="sq-grid-3">
            {marketing.howItWorks.steps.map((item) => (
              <div key={item.title} className="sq-list-item">
                <div className="sq-list-title">{item.title}</div>
                <div className="sq-list-meta">{item.description}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="sq-card" aria-labelledby="landing-why-title">
          <div className="sq-progress-head">
            <div>
              <h2 id="landing-why-title" className="sq-list-title">
                {t("marketing.whyItWorks.title")}
              </h2>
              <div className="sq-list-meta">{t("marketing.whyItWorks.subtitle")}</div>
            </div>
          </div>

          <div className="sq-grid-3">
            {marketing.whyItWorks.items.map(([title, copy]) => (
              <div key={title} className="sq-list-item">
                <div className="sq-list-title">{title}</div>
                <div className="sq-list-meta">{copy}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="produto" className="sq-card" aria-labelledby="landing-preview-title">
          <div className="sq-progress-head">
            <div>
              <h2 id="landing-preview-title" className="sq-list-title">
                {t("marketing.preview.title")}
              </h2>
              <div className="sq-list-meta">{t("marketing.preview.subtitle")}</div>
            </div>
          </div>

          <div className="sq-grid-3">
            {marketing.preview.cards.map((item) => (
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

        <section className="sq-card" aria-labelledby="landing-offer-title">
          <div className="sq-progress-head">
            <div>
              <h2 id="landing-offer-title" className="sq-list-title">
                {t("marketing.offer.title")}
              </h2>
              <div className="sq-list-meta">{t("marketing.offer.subtitle")}</div>
            </div>
          </div>

          <div className="sq-grid-2">
            {marketing.offer.items.map(([title, description]) => (
              <div key={title} className="sq-list-item">
                <div className="sq-list-title">{title}</div>
                <div className="sq-list-meta">{description}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="sq-card" aria-labelledby="landing-faq-title">
          <div className="sq-progress-head">
            <div>
              <h2 id="landing-faq-title" className="sq-list-title">
                {t("marketing.faq.title")}
              </h2>
              <div className="sq-list-meta">{t("marketing.faq.subtitle")}</div>
            </div>
          </div>

          <dl className="sq-list">
            {marketing.faq.items.map(([question, answer]) => (
              <div key={question} className="sq-list-item">
                <dt className="sq-list-title">{question}</dt>
                <dd className="sq-list-meta" style={{ margin: 0 }}>
                  {answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="sq-card" aria-labelledby="landing-trust-title">
          <div className="sq-progress-head">
            <div>
              <h2 id="landing-trust-title" className="sq-list-title">
                {t("marketing.trust.title")}
              </h2>
              <div className="sq-list-meta">{t("marketing.trust.subtitle")}</div>
            </div>
          </div>

          <div className="sq-chip-row">
            {marketing.trust.chips.map((item) => (
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
            <LandingAuthCta variant="footer" />
          </div>
        </section>
      </div>
    </main>
  );
}
