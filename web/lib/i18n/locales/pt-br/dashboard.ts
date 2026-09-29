export const dashboard = {
  defaults: {
    recommendedNextAction: "Comece uma sessão curta para retomar o ritmo."
  },
  loadError: "Nem tudo foi carregado: {items}.",
  failedAreas: {
    weakAreas: "lacunas",
    pace: "ritmo",
    review: "revisão",
    history: "histórico",
    examSessions: "sessões de simulado",
    studySessions: "sessões de estudo",
    readiness: "prontidão",
    studyPlan: "plano de estudo"
  },
  modes: {
    examMixed: "Simulado misto",
    studyMixed: "Estudo misto"
  },
  header: {
    title: "Hoje",
    subtitle: "Seu foco de hoje: revisar o que venceu e manter consistência."
  },
  todayCard: {
    title: "Hoje",
    subtitle: "Uma ação principal: limpar o que está vencido.",
    dueReviews: "Revisões vencidas",
    dailyProgress: "Progresso diário",
    latestScore: "Último score",
    nextStep: "Próximo passo",
    readiness: "Prontidão",
    projection: "projeção {value}"
  },
  continueCard: {
    title: "Continuar",
    subtitle: "Retome apenas o que ainda faz sentido.",
    empty: "Nenhuma sessão ativa. Abra um novo bloco quando quiser."
  },
  weakAreasCard: {
    title: "Pontos fracos",
    subtitle: "Somente os sinais mais úteis para decidir o próximo bloco.",
    empty: "Sem histórico suficiente para destacar lacunas ainda."
  },
  summaryCard: {
    title: "Resumo rápido",
    subtitle: "Contexto mínimo para não perder o ritmo.",
    currentStreak: "Streak atual",
    bestStreak: "Melhor streak",
    week: "Semana",
    reviewGoal: "Meta de revisão",
    nextReview: "Próxima revisão",
    update: "Atualização"
  },
  planCard: {
    title: "Meu plano",
    subtitle: "A próxima melhor ação sempre fica visível.",
    placementPending: "Diagnóstico pendente",
    nextModule: "Próximo módulo: {code} · {title}",
    nextModuleHint: "Sugerido para reforçar {domain} seguindo a ordem da trilha.",
    trackItem: "{position}. {title}"
  },
  trackCard: {
    title: "Trilha {certification}",
    subtitle: "Módulos na ordem recomendada, com status, domínio e pré-requisitos.",
    listLabel: "Módulos da trilha {certification}",
    summary: "{completed} de {total} módulos concluídos",
    recommended: "Recomendado agora",
    mastery: "Domínio {value}",
    masteryUnknown: "Domínio sem dados",
    attempts: "{count} tentativa(s)",
    pendingPrerequisites: "Pré-requisitos pendentes: {items}",
    status: {
      locked: "Bloqueado",
      available: "Disponível",
      in_progress: "Em andamento",
      completed: "Concluído"
    }
  },
  weekCard: {
    title: "Esta semana",
    subtitle: "Progresso e pressão de revisão em um resumo curto.",
    reviewBacklog: "Backlog",
    weeklyProgress: "Meta semanal",
    reviewGoal: "Meta de revisão"
  },
  masteryCard: {
    title: "Domínio por área",
    subtitle: "A prontidão mostra as lacunas por domínio, com acerto, confiança e ritmo.",
    accuracy: "acerto {value}",
    attempts: "{count} tentativa(s)",
    pace: "ritmo {value}",
    lowConfidence: "baixa confiança {count}"
  }
} as const;
