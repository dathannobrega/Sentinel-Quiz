"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { fetchCurrentUser } from "@/lib/auth/session";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";

export function LandingPageShell() {
  const router = useRouter();
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
      setLoadError(error instanceof Error ? error.message : "Nao foi possivel verificar a sessao.");
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
            title="Sessao indisponivel"
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
            <div className="sq-eyebrow">Security+ e CISSP</div>
            <h1 className="sq-hero-title">Treine para Security+ e CISSP com simulados e revisao inteligente.</h1>
            <p className="sq-hero-lead">
              Questoes com explicacoes, modo prova cronometrado, fila de revisao (SRS) e metricas por dominio para atacar seus pontos fracos.
            </p>
            <div className="sq-actions">
              <Link href="/register" className="sq-button sq-button--md sq-button--primary">
                Comecar gratis
              </Link>
              <a href="#como-funciona" className="sq-button sq-button--md sq-button--ghost">
                Ver demo
              </a>
            </div>
            <div className="sq-chip-row">
              <span className="sq-chip">Sem cartao</span>
              <span className="sq-chip">Acesso imediato</span>
              <span className="sq-chip">Desktop e celular</span>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">Como funciona</div>
              <div className="sq-list-meta">Fluxo curto, direto e orientado para evolucao real.</div>
            </div>
          </div>

          <div className="sq-grid-3">
            <div className="sq-list-item">
              <div className="sq-list-title">1. Escolha a certificacao e o objetivo</div>
              <div className="sq-list-meta">Study ou Exam, com filtros por dominio, dificuldade e foco atual.</div>
            </div>
            <div className="sq-list-item">
              <div className="sq-list-title">2. Responda e entenda o porquê</div>
              <div className="sq-list-meta">Explicacoes, nivel de confianca, hints graduais e referencias oficiais.</div>
            </div>
            <div className="sq-list-item">
              <div className="sq-list-title">3. Revise o que voce erra</div>
              <div className="sq-list-meta">Fila inteligente, analytics por dominio e progresso semanal.</div>
            </div>
          </div>
        </section>

        <section className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">Por que isso funciona</div>
              <div className="sq-list-meta">Treino, diagnostico e reforco no mesmo loop.</div>
            </div>
          </div>

          <div className="sq-grid-3">
            {[
              ["Simulados cronometrados", "Tempo real, pausa controlada e revisao final."],
              ["Revisao inteligente (SRS)", "Volte exatamente no que voce erra ou acerta sem seguranca."],
              ["Analise por dominio", "Veja rapidamente onde estao suas lacunas."],
              ["Explicacoes completas", "Nao e so letra certa: o sistema orienta o raciocinio."],
              ["Notas e favoritos", "Construa sua trilha pessoal de estudo."],
              ["Tutor IA opcional", "Use quando precisar destravar uma duvida pontual."]
            ].map(([title, copy]) => (
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
              <div className="sq-list-title">Preview do produto</div>
              <div className="sq-list-meta">Tudo que voce precisa, sem distracao.</div>
            </div>
          </div>

          <div className="sq-grid-3">
            <Card title="Dashboard" subtitle="Dominios fracos, meta semanal e retomada rapida.">
              <div className="sq-chip-row">
                <span className="sq-chip">weak areas</span>
                <span className="sq-chip">ritmo</span>
                <span className="sq-chip">retencao</span>
              </div>
            </Card>
            <Card title="Exam Runner" subtitle="Timer, navegacao e foco total na execucao.">
              <div className="sq-chip-row">
                <span className="sq-chip">tempo real</span>
                <span className="sq-chip">pausa</span>
                <span className="sq-chip">resultado</span>
              </div>
            </Card>
            <Card title="Revisao" subtitle="Fila, explicacao e contexto de estudo.">
              <div className="sq-chip-row">
                <span className="sq-chip">SRS</span>
                <span className="sq-chip">hints</span>
                <span className="sq-chip">referencias</span>
              </div>
            </Card>
          </div>
        </section>

        <section className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">Oferta</div>
              <div className="sq-list-meta">Acesso beta: gratuito por tempo limitado.</div>
            </div>
          </div>

          <div className="sq-grid-2">
            <div className="sq-list-item">
              <div className="sq-list-title">Beta gratuito</div>
              <div className="sq-list-meta">Study mode, exam mode, revisao basica e analytics principais.</div>
            </div>
            <div className="sq-list-item">
              <div className="sq-list-title">Evolucao planejada</div>
              <div className="sq-list-meta">Analytics completos, simulados adaptativos mais profundos e features premium.</div>
            </div>
          </div>
        </section>

        <section id="faq" className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">FAQ</div>
              <div className="sq-list-meta">Objetivo, independente e transparente.</div>
            </div>
          </div>

          <div className="sq-list" role="list">
            {[
              ["Isso e dump?", "Nao. O foco e treino com explicacao, hints e revisao para entender o conteudo."],
              ["E afiliado a CompTIA ou ISC2?", "Nao. E uma plataforma independente."],
              ["As questoes sao atualizadas?", "Sim. O catalogo e versionado e revisado continuamente."],
              ["Posso estudar no celular?", "Sim. O fluxo foi desenhado para desktop e mobile."],
              ["Como funcionam metas e revisao?", "O sistema registra seu desempenho, monta fila de reforco e sugere a proxima acao."]
            ].map(([question, answer]) => (
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
              <div className="sq-list-title">Confianca e transparencia</div>
              <div className="sq-list-meta">Sem exagero de promessa e sem dependencia de decoreba.</div>
            </div>
          </div>

          <div className="sq-chip-row">
            <span className="sq-chip">Dados protegidos</span>
            <span className="sq-chip">Sessao segura</span>
            <span className="sq-chip">Sem spam</span>
            <span className="sq-chip">Plataforma independente</span>
          </div>
        </section>

        <section className="sq-card sq-hero" style={{ padding: "var(--sq-space-6)" }}>
          <div className="sq-hero-copy">
            <div className="sq-eyebrow">Pronto para comecar</div>
            <h2 className="sq-hero-title">Comece hoje e veja seu progresso em 7 dias.</h2>
            <div className="sq-actions">
              <Link href="/register" className="sq-button sq-button--md sq-button--primary">
                Comecar gratis
              </Link>
              <Link href="/login" className="sq-button sq-button--md sq-button--ghost">
                Ja tenho conta
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
