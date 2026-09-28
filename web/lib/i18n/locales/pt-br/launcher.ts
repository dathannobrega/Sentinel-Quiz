export const launcher = {
  card: {
    title: "Começar sessão",
    subtitle: "Escolha o essencial e inicie em poucos segundos."
  },
  fields: {
    certification: "Certificação",
    mode: "Modo",
    questions: "Questões",
    timeMinutes: "Tempo (min)",
    experienceMode: "Experiência",
    experienceModeHint: "Modo prova simula o dia do exame: sem correção instantânea, sem tutor e sem dicas até o envio final.",
    advancedFilters: "Filtros avançados",
    domain: "Domínio",
    strategy: "Estratégia",
    difficulty: "Dificuldade",
    tags: "Tags"
  },
  advanced: {
    active: "ativos",
    optional: "opcionais"
  },
  presets: {
    title: "Presets",
    summaryTitle: "Resumo do preset",
    items: {
      placement: {
        title: "Diagnóstico inicial",
        summary: "20 questões adaptativas para criar sua baseline por domínio."
      },
      daily_review: {
        title: "Revisão diária recomendada",
        summary: "10 questões puxadas para reforçar memória e confiança."
      },
      quick_15: {
        title: "Simulado rápido 15 min",
        summary: "15 questões em 15 minutos para medir retenção."
      },
      comptia_exam: {
        title: "Modo prova CompTIA",
        summary: "45 questões com foco em blueprint e pressão de prova."
      },
      sprint_25: {
        title: "Sprint 25 min",
        summary: "20 questões adaptativas para manter ritmo sem sobrecarga."
      },
      risk_focus: {
        title: "Risco de prova",
        summary: "Bloco curto e focado para atacar o domínio mais sensível agora."
      },
      custom: {
        title: "Custom",
        summary: "Ajuste manualmente os filtros e monte um bloco sob medida."
      }
    }
  },
  experienceModes: {
    standard: "Padrão (com correção)",
    examDay: "Modo prova (dia do exame)"
  },
  filters: {
    bookmarked: "Marcadas",
    notes: "Com nota",
    incorrect: "Erradas",
    unseen: "Novas",
    lowConfidence: "Baixa confiança"
  },
  actions: {
    createStudyBlock: "Criar bloco de estudo",
    createExam: "Criar simulado"
  }
} as const;
