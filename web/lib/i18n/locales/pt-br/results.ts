export const results = {
  errors: {
    loadResult: "Não foi possível carregar o resultado desta sessão.",
    bannerTitle: "Não foi possível carregar o resultado",
    missingReview: "A sessão não retornou dados de revisão."
  },
  insights: {
    answered: "Respondidas: {count}",
    accuracy: "Precisão: {value}%",
    averagePerQuestion: "Média por questão: {value}s",
    weakestDomain: "Domínio mais sensível: {label}",
    weakestDomainWithErrors: "Domínio mais sensível: {label} ({count} erro(s))",
    reviewDueAfter: "Fila vencida após o bloco: {count}"
  },
  readiness: {
    excellent: "Excelente",
    good: "Bom",
    ok: "Ok",
    tuning: "Em ajuste"
  },
  citations: {
    openMaterial: "Abrir material"
  },
  reviewBlock: {
    question: "Questão {number}",
    noMetadata: "Sem metadados",
    correct: "Correta",
    wrong: "Errada",
    correctSuffix: " (correta)",
    selectedSuffix: " (sua escolha)"
  },
  header: {
    title: "Resultado da sessão",
    mixedSession: "Sessão mista",
    completedAt: "concluída em {date}"
  },
  summary: {
    studyTitle: "{score} de aproveitamento em estudo",
    examTitle: "{score} de score · prontidão {readiness}",
    strategySubtitle: "Estratégia {strategy}.",
    minutes: "{value} min",
    score: "Score",
    readiness: "Prontidão",
    correct: "Acertos",
    wrong: "Erros",
    answered: "Respondidas",
    questions: "Questões",
    timeUsed: "Tempo usado",
    timeLimit: "Limite",
    passThreshold: "Nota de aprovação",
    passThresholdNotes: {
      CEH: "A nota de corte oficial do CEH varia de 60% a 85% conforme a forma do exame; usamos 70% como referência."
    },
    timedOutTitle: "Simulado encerrado por tempo",
    timedOutMessage:
      "O backend aplicou auto-submit quando o cronômetro zerou. Revise primeiro os itens errados e os que ficaram sem resposta."
  },
  reviewCard: {
    title: "Revisão guiada",
    subtitle: "Abra cada questão apenas quando precisar revisar o detalhe.",
    questionCount: "{count} questões",
    empty: "Nenhuma questão foi encontrada para esta revisão."
  },
  readinessCard: {
    title: "Readiness Score",
    subtitle: "Atual {current} · projetado {projected}",
    band: "Faixa",
    suggestedSession: "Sessão sugerida",
    trackedBase: "Base rastreada",
    byDomain: "Domínio por domínio",
    accuracy: "acerto {value}",
    pace: "ritmo {value}",
    lowConfidence: "baixa confiança {count}",
    attempts: "{count} tentativa(s)"
  },
  timingCard: {
    title: "Ritmo da sessão",
    subtitle: "Velocidade e dispersão agora entram de forma explícita na leitura de prontidão.",
    duration: "Duração",
    averagePerQuestion: "Média por questão",
    fastest: "Mais rápida",
    slowest: "Mais lenta"
  },
  studyPlanCard: {
    title: "Plano recomendado (15-45 min)",
    subtitle: "Priorize os domínios com maior atrito e entre direto em revisão focada.",
    openReview: "Iniciar revisão",
    openReferences: "Abrir referências",
    itemTitle: "{domain} · {wrong}/{total} erradas · {score}"
  },
  tutor: {
    title: "Tutor da questão",
    explain: "Me explique",
    whyWrong: "Por que errei?",
    reviewTopic: "Revisar assunto",
    loading: "Consultando tutor...",
    unavailable: "Tutor indisponível",
    blocked: "Tutor bloqueou esta análise",
    answered: "Tutor respondeu",
    authRequired: "Entre na sua conta para usar o tutor de IA.",
    lockedDuringExam: "O tutor fica disponível depois que o simulado é finalizado.",
    quotaExceeded: "Você atingiu a cota diária do tutor. Tente novamente amanhã.",
    quotaExceededRetry: "Você atingiu a cota do tutor. Tente novamente em {seconds}s.",
    upstream: "O tutor de IA está temporariamente indisponível. Tente novamente em instantes.",
    signIn: "Entrar para usar o tutor"
  },
  issueReport: {
    title: "Reportar questão",
    clarity: "Clareza",
    answerKey: "Gabarito",
    explanation: "Explicação",
    reference: "Referência",
    send: "Enviar reporte",
    success: "Reporte enviado para o backlog editorial.",
    failure: "Não foi possível reportar esta questão agora.",
    categoryLabel: "Categoria do reporte",
    messageLabel: "Descreva o problema (mín. 8 caracteres)"
  }
} as const;
