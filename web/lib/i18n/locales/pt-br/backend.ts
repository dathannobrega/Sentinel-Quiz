/**
 * Translations of backend message codes (`code` + `params`, M-C7). Keys mirror the codes
 * sent by the API ("study_plan.risk_domain" -> backend.study_plan.risk_domain). Unknown
 * codes fall back to the backend text (see lib/i18n/backend-messages.ts).
 */
export const backend = {
  study_plan: {
    placement: {
      title: "Fazer diagnóstico inicial",
      description: "Monte uma baseline curta por domínio antes de entrar em simulados mais pesados.",
      cta: "Iniciar diagnóstico"
    },
    review_backlog: {
      title: "Limpar revisões vencidas",
      description: "{count} revisão(ões) estão vencidas agora.",
      cta: "Abrir revisão"
    },
    risk_domain: {
      title: "Atacar risco de prova em {domain}",
      description: "Seu pior domínio atual merece um bloco focado curto antes do próximo simulado misto.",
      cta: "Abrir bloco focado"
    },
    momentum: {
      title: "Manter ritmo com um bloco curto",
      description: "Sem backlog crítico no momento. Preserve variedade e consistência.",
      cta: "Iniciar sprint"
    },
    notes: {
      title: "Revisar seu caderno",
      description: "Use suas notas recentes para reforçar os pontos com mais atrito.",
      cta: "Abrir configurações"
    },
    targeted_review: {
      title: "Revisão focada em {domain}",
      description: "Transforme o sinal de prontidão em revisão orientada por domínio.",
      cta: "Filtrar revisão"
    },
    quick_exam: {
      title: "Medir retenção com um simulado curto",
      description: "Use um bloco rápido para validar se o reforço já consolidou.",
      cta: "Abrir simulado"
    }
  },
  readiness: {
    insufficient_data:
      "Ainda há pouco histórico recente ({attempts} de {required} respostas). Responda mais questões para liberar a estimativa.",
    overdue_reviews: "{count} revisão(ões) vencida(s) reduzem a sua projeção.",
    session_weakest_domain: "{domain} segue como o ponto de maior atrito na sessão atual.",
    weakest_domain: "{domain} é o domínio com menor desempenho ({score}%).",
    slow_domain: "Velocidade: {domain} está lento ({seconds}s por questão em média).",
    low_coverage: "A estimativa cobre só {coverage}% do blueprint; pratique os domínios que faltam.",
    stale_activity: "Sua recência caiu; volte a revisar nas próximas 24 horas.",
    consistent: "Base consistente. O foco agora é reduzir erros residuais e manter o ritmo."
  },
  weak_area: {
    no_data: "Ainda não há histórico suficiente para este track.",
    low_accuracy: "Maior necessidade de estudo: {domain} ({wrong} erro(s) em {total} questões).",
    needs_practice: "{domain} ainda pede reforço ({wrong} erro(s) em {total} questões).",
    on_track: "{domain} está em dia. Mantenha com revisões espaçadas.",
    focus_domain: "Foco recomendado: {domain} ({wrong} erro(s) e {low_confidence} resposta(s) com baixa confiança em {total} questões)."
  },
  study_feedback: {
    wrong_review_soon: "Erro convertido em revisão. Esta questão voltará rapidamente para reforço.",
    correct_low_confidence: "Acerto com baixa confiança. A revisão volta cedo para consolidar.",
    correct_medium_confidence: "Bom progresso. A revisão volta em alguns dias.",
    correct_high_confidence: "Alta confiança registrada. Esta questão foi empurrada para uma revisão mais espaçada."
  },
  readinessBands: {
    strong: "Forte",
    stable: "Estável",
    developing: "Em desenvolvimento",
    at_risk: "Em risco",
    insufficient_data: "Dados insuficientes"
  }
} as const;
