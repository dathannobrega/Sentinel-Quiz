export const ptBRMessages = {
  metadata: {
    title: "Sentinel Quiz | Security+ e CISSP",
    description:
      "Treine para Security+ e CISSP com simulados, estudo guiado, revisão inteligente e métricas por domínio."
  },
  common: {
    appName: "Sentinel Quiz",
    labels: {
      dashboard: "Dashboard",
      start: "Iniciar",
      review: "Revisão",
      history: "Histórico",
      settings: "Configurações",
      admin: "Administração",
      exam: "Simulado",
      study: "Estudo"
    },
    actions: {
      signIn: "Entrar",
      signOut: "Sair",
      createAccount: "Criar conta",
      refresh: "Atualizar",
      continue: "Continuar",
      retry: "Tentar novamente",
      openHistory: "Abrir histórico",
      reviewNow: "Revisar agora",
      newSession: "Nova sessão",
      seeDetails: "Ver detalhes",
      resume: "Retomar",
      pause: "Pausar",
      goToDashboard: "Ir para o dashboard",
      backToDashboard: "Voltar ao dashboard",
      openResult: "Tentar abrir o resultado",
      resendVerification: "Reenviar verificação",
      startFree: "Começar grátis",
      seeDemo: "Ver demo",
      alreadyHaveAccount: "Já tenho conta",
      goToStart: "Iniciar nova sessão",
      nextQuestion: "Próxima questão",
      viewResult: "Ver resultado"
    },
    status: {
      marked: "marcada",
      withNote: "com nota",
      syncingSession: "Sincronizando sessão...",
      updating: "Atualizando",
      upToDate: "Em dia"
    },
    filters: {
      all: "Todas",
      everything: "Tudo",
      allDomains: "Todos os domínios",
      mixedRandom: "Misturar todas (aleatório)",
      selectExam: "Selecione uma prova"
    },
    reviewStates: {
      dueToday: "Vence hoje",
      overdue: "Atrasadas",
      atRisk: "Em risco",
      scheduled: "Agendadas",
      mastered: "Dominadas"
    },
    strategies: {
      standard: "Padrão",
      adaptive: "Adaptativa"
    },
    confidence: {
      guess: "Chutei",
      notSure: "Não tenho certeza",
      confident: "Tenho certeza"
    },
    errors: {
      unexpected: "Ocorreu um erro inesperado.",
      attention: "Atenção",
      partialLoad: "Carga parcial",
      sessionUnavailable: "Sessão indisponível",
      authFailure: "Falha de autenticação"
    }
  },
  navigation: {
    ariaLabel: "Navegação principal",
    brandTitle: "Sentinel Quiz",
    brandSubtitle: "Simulados, estudo guiado e revisão inteligente para Security+ e CISSP.",
    publicLinks: {
      howItWorks: "Como funciona",
      faq: "FAQ"
    },
    errors: {
      sessionRefresh: "Não foi possível atualizar a sessão."
    }
  },
  dashboard: {
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
      studySessions: "sessões de estudo"
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
      nextStep: "Próximo passo"
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
    }
  },
  launcher: {
    card: {
      title: "Começar sessão",
      subtitle: "Escolha o essencial e inicie em poucos segundos."
    },
    fields: {
      certification: "Certificação",
      mode: "Modo",
      questions: "Questões",
      timeMinutes: "Tempo (min)",
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
  },
  start: {
    errors: {
      searchUnavailable: "Busca de questões indisponível: {message}",
      unexpected: "Ocorreu um erro inesperado.",
      createSessionTitle: "Não foi possível criar a sessão",
      invalidQuantityTitle: "Quantidade inválida",
      invalidQuantityMessage: "Informe pelo menos 1 questão.",
      quantityLimitTitle: "Quantidade acima do limite",
      quantityLimitMessage: "O limite atual para {mode} é {count} questões.",
      invalidTimeTitle: "Tempo inválido",
      invalidTimeMessage: "Use entre 5 e 360 minutos."
    },
    notices: {
      loadingDomainsTitle: "Atualizando domínios",
      loadingDomainsMessage: "Carregando os filtros da certificação."
    },
    header: {
      title: "Iniciar",
      subtitle: "Monte um bloco curto, comece rápido e deixe o resto sob demanda."
    },
    discovery: {
      summary: "Explorar banco de questões",
      foundCount: "{count} encontrada(s)",
      title: "Descobrir questões",
      subtitle: "Procure no banco apenas quando precisar refinar o recorte.",
      query: "Texto",
      domain: "Domínio",
      tag: "Tag",
      queryPlaceholder: "Ex.: cryptography, asset, incident",
      tagPlaceholder: "Ex.: access control",
      bookmarkedOnly: "Apenas marcadas",
      notesOnly: "Apenas com nota",
      resultsAriaLabel: "Resultados da busca de questões",
      loading: "Atualizando resultados...",
      empty: "Nenhuma questão encontrada com os filtros atuais."
    }
  },
  review: {
    errors: {
      loadQueue: "Não foi possível carregar a fila de revisão."
    },
    header: {
      title: "Revisão",
      subtitle: "Priorize o que vence agora e mantenha a fila sob controle."
    },
    todayCard: {
      title: "Fila de hoje",
      subtitle: "Uma única ação principal: revisar o que já está vencido.",
      due: "Vencidas",
      total: "Total na fila",
      suggestedBatch: "Lote sugerido"
    },
    filters: {
      title: "Refinar fila",
      subtitle: "Ajuste o recorte sem transformar a revisão em um painel pesado.",
      certification: "Certificação",
      state: "Recorte",
      refine: "Refino",
      bookmarksOnly: "Só marcadas",
      notesOnly: "Só com nota"
    },
    priorityCard: {
      title: "Itens priorizados",
      subtitle: "Os itens mais sensíveis ficam no topo."
    },
    empty: "Nenhum item de revisão pendente no momento.",
    queueState: {
      overdue: "atrasada há {days} dia(s)",
      dueToday: "vence hoje",
      atRisk: "vence em até 48h",
      mastered: "já consolidada",
      scheduledFor: "agendada para {date}",
      scheduled: "agendada"
    }
  },
  settings: {
    header: {
      title: "Configurações",
      subtitle: "Conta, sincronização e o seu caderno pessoal em um lugar separado."
    },
    notices: {
      loggedOutTitle: "Sessão encerrada",
      loggedOutMessage: "Você voltou ao modo local deste dispositivo.",
      logoutFailureTitle: "Falha ao sair"
    }
  },
  account: {
    card: {
      title: "Conta e sincronização",
      subtitle: "Sincronize progresso entre dispositivos sem perder o fallback local."
    },
    summary: {
      ariaLabel: "Resumo da conta",
      bookmarks: "Marcadores",
      notes: "Notas",
      dueReviews: "Revisões vencidas"
    },
    lists: {
      updatedAt: "Atualizado em {date}",
      recentBookmarks: "Marcadores recentes",
      recentNotes: "Notas recentes",
      reviewQueue: "Fila de revisão",
      noBookmarks: "Nenhum marcador salvo ainda.",
      noNotes: "Nenhuma nota salva ainda.",
      noDueReviews: "Nenhuma revisão vencida no momento."
    },
    guest: {
      localModeTitle: "Modo local ativo",
      localModeMessage:
        "Você ainda pode usar o dispositivo atual, mas o progresso não está sincronizado entre navegadores.",
      signInTitle: "Autentique para consolidar o histórico",
      signInMessage:
        "Ao entrar, o backend associa sessões, marcadores, notas e revisões deste dispositivo à sua conta."
    },
    user: {
      roleLabel: "papel",
      sinceLabel: "desde"
    }
  },
  insights: {
    empty: {
      exams: "Nenhum simulado concluído ainda. Crie um primeiro bloco para popular esse painel.",
      study: "Nenhum bloco de estudo concluído ainda.",
      weakAreas: "Sem histórico suficiente para detectar lacunas ainda."
    },
    titles: {
      weakAreas: "Lacunas e dependência por área",
      weakAreasSubtitle: "Esse bloco traduz o histórico atual em prioridade de estudo por certificação.",
      queueAndActivity: "Fila de revisão e atividade",
      queueAndActivitySubtitle: "Visibilidade rápida do que está pendente e do que já foi estudado.",
      latestExams: "Últimos simulados",
      latestStudy: "Últimos blocos de estudo"
    },
    labels: {
      recentErrors: "{ratio}% de erros recentes",
      focus: "Foco",
      dueReviews: "Revisões vencidas",
      recentExams: "Simulados recentes",
      studyBlocks: "Blocos de estudo",
      mixedExam: "Simulado misto",
      mixedStudy: "Bloco misto",
      correctAnswers: "corretas",
      strategy: "estratégia",
      reviewedOn: "revisado em {date}"
    }
  },
  history: {
    errors: {
      loadHistory: "Não foi possível carregar o histórico agora.",
      partialLoad: "Alguns blocos falharam ao carregar: {items}."
    },
    failedAreas: {
      exams: "provas",
      examSessions: "simulados",
      study: "estudo",
      weekly: "análise semanal",
      reviewQueue: "fila de revisão"
    },
    header: {
      title: "Histórico e análises",
      subtitle: "Sessões, revisão e ritmo semanal separados por contexto."
    },
    filters: {
      title: "Filtros",
      subtitle: "Refine a leitura sem transformar tudo em um megapainel.",
      exam: "Prova",
      minimumScore: "Nota mínima",
      search: "Busca"
    },
    tabs: {
      sessions: "Sessões",
      review: "Revisão",
      weeks: "Semanas"
    }
  },
  results: {
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
      score: "Score",
      readiness: "Prontidão",
      correct: "Acertos",
      wrong: "Erros",
      answered: "Respondidas",
      questions: "Questões",
      timeUsed: "Tempo usado",
      timeLimit: "Limite",
      timedOutTitle: "Simulado encerrado por tempo",
      timedOutMessage:
        "O backend aplicou auto-submit quando o cronômetro zerou. Revise primeiro os itens errados e os que ficaram sem resposta."
    },
    reviewCard: {
      title: "Revisão guiada",
      subtitle: "Abra cada questão apenas quando precisar revisar o detalhe.",
      questionCount: "{count} questões",
      empty: "Nenhuma questão foi encontrada para esta revisão."
    }
  },
  runner: {
    header: {
      studyTitle: "Modo Estudo",
      examTitle: "Modo Simulado",
      subtitle: "Pergunta no centro. Ferramentas de apoio ao lado."
    },
    labels: {
      confidence: "Confiança",
      noActiveQuestion: "Nenhuma questão ativa encontrada para esta sessão.",
      tools: "Ferramentas",
      hints: "Dicas",
      hintsSubtitle: "Abra apenas quando precisar de um empurrão.",
      notes: "Notas",
      notesSubtitle: "Marque e registre contexto só quando for útil.",
      references: "Referências"
    }
  }
} as const;

export type PtBRMessages = typeof ptBRMessages;