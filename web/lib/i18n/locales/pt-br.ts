export const ptBRMessages = {
  metadata: {
    title: "Sentinel Quiz | Security+ e CISSP",
    description:
      "Treine para Security+ e CISSP com simulados, estudo guiado, revisao inteligente e metricas por dominio."
  },
  common: {
    appName: "Sentinel Quiz",
    labels: {
      dashboard: "Dashboard",
      start: "Iniciar",
      review: "Revisao",
      history: "Historico",
      settings: "Configuracoes",
      admin: "Administracao",
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
      openHistory: "Abrir historico",
      reviewNow: "Revisar agora",
      newSession: "Nova sessao",
      seeDetails: "Ver detalhes",
      resume: "Retomar",
      pause: "Pausar",
      goToDashboard: "Ir para o dashboard",
      backToDashboard: "Voltar ao dashboard",
      openResult: "Tentar abrir o resultado",
      resendVerification: "Reenviar verificacao",
      startFree: "Comecar gratis",
      seeDemo: "Ver demo",
      alreadyHaveAccount: "Ja tenho conta",
      goToStart: "Iniciar nova sessao",
      nextQuestion: "Proxima questao",
      viewResult: "Ver resultado"
    },
    status: {
      marked: "marcada",
      withNote: "com nota",
      syncingSession: "Sincronizando sessao...",
      updating: "Atualizando",
      upToDate: "Em dia"
    },
    filters: {
      all: "Todas",
      everything: "Tudo",
      allDomains: "Todos os dominios",
      mixedRandom: "Misturar todas (random)",
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
      standard: "Padrao",
      adaptive: "Adaptativa"
    },
    confidence: {
      guess: "Chutei",
      notSure: "Nao tenho certeza",
      confident: "Tenho certeza"
    },
    errors: {
      unexpected: "Ocorreu um erro inesperado.",
      attention: "Atencao",
      partialLoad: "Carga parcial",
      sessionUnavailable: "Sessao indisponivel",
      authFailure: "Falha de autenticacao"
    }
  },
  navigation: {
    ariaLabel: "Navegacao principal",
    brandTitle: "Sentinel Quiz",
    brandSubtitle: "Simulados, estudo guiado e revisao inteligente para Security+ e CISSP.",
    publicLinks: {
      howItWorks: "Como funciona",
      faq: "FAQ"
    },
    errors: {
      sessionRefresh: "Nao foi possivel atualizar a sessao."
    }
  },
  dashboard: {
    defaults: {
      recommendedNextAction: "Comece uma sessao curta para retomar o ritmo."
    },
    loadError: "Nem tudo foi carregado: {items}.",
    failedAreas: {
      weakAreas: "lacunas",
      pace: "ritmo",
      review: "revisao",
      history: "historico",
      examSessions: "sessoes de simulado",
      studySessions: "sessoes de estudo"
    },
    modes: {
      examMixed: "Simulado misto",
      studyMixed: "Estudo misto"
    },
    header: {
      title: "Hoje",
      subtitle: "Seu foco de hoje: revisar o que venceu e manter consistencia."
    },
    todayCard: {
      title: "Hoje",
      subtitle: "Uma acao principal: limpar o que esta vencido.",
      dueReviews: "Revisoes vencidas",
      dailyProgress: "Progresso diario",
      latestScore: "Ultimo score",
      nextStep: "Proximo passo"
    },
    continueCard: {
      title: "Continuar",
      subtitle: "Retome apenas o que ainda faz sentido.",
      empty: "Nenhuma sessao ativa. Abra um novo bloco quando quiser."
    },
    weakAreasCard: {
      title: "Pontos fracos",
      subtitle: "Somente os sinais mais uteis para decidir o proximo bloco.",
      empty: "Sem historico suficiente para destacar lacunas ainda."
    },
    summaryCard: {
      title: "Resumo rapido",
      subtitle: "Contexto minimo para nao perder o ritmo.",
      currentStreak: "Streak atual",
      bestStreak: "Melhor streak",
      week: "Semana",
      reviewGoal: "Meta de revisao",
      nextReview: "Proxima revisao",
      update: "Atualizacao"
    }
  },
  launcher: {
    card: {
      title: "Comecar sessao",
      subtitle: "Escolha o essencial e inicie em poucos segundos."
    },
    fields: {
      certification: "Certificacao",
      mode: "Modo",
      questions: "Questoes",
      timeMinutes: "Tempo (min)",
      advancedFilters: "Filtros avancados",
      domain: "Dominio",
      strategy: "Estrategia",
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
      lowConfidence: "Baixa confianca"
    },
    actions: {
      createStudyBlock: "Criar bloco de estudo",
      createExam: "Criar simulado"
    }
  },
  start: {
    errors: {
      searchUnavailable: "Busca de questoes indisponivel: {message}",
      unexpected: "Ocorreu um erro inesperado.",
      createSessionTitle: "Nao foi possivel criar a sessao",
      invalidQuantityTitle: "Quantidade invalida",
      invalidQuantityMessage: "Informe pelo menos 1 questao.",
      quantityLimitTitle: "Quantidade acima do limite",
      quantityLimitMessage: "O limite atual para {mode} e {count} questoes.",
      invalidTimeTitle: "Tempo invalido",
      invalidTimeMessage: "Use entre 5 e 360 minutos."
    },
    notices: {
      loadingDomainsTitle: "Atualizando dominios",
      loadingDomainsMessage: "Carregando os filtros da certificacao."
    },
    header: {
      title: "Iniciar",
      subtitle: "Monte um bloco curto, comece rapido e deixe o resto sob demanda."
    },
    discovery: {
      summary: "Explorar banco de questoes",
      foundCount: "{count} encontrada(s)",
      title: "Descobrir questoes",
      subtitle: "Procure no banco apenas quando precisar refinar o recorte.",
      query: "Texto",
      domain: "Dominio",
      tag: "Tag",
      queryPlaceholder: "Ex.: cryptography, asset, incident",
      tagPlaceholder: "Ex.: access control",
      bookmarkedOnly: "Apenas marcadas",
      notesOnly: "Apenas com nota",
      resultsAriaLabel: "Resultados da busca de questoes",
      loading: "Atualizando resultados...",
      empty: "Nenhuma questao encontrada com os filtros atuais."
    }
  },
  review: {
    errors: {
      loadQueue: "Nao foi possivel carregar a fila de revisao."
    },
    header: {
      title: "Revisao",
      subtitle: "Priorize o que vence agora e mantenha a fila sob controle."
    },
    todayCard: {
      title: "Fila de hoje",
      subtitle: "Uma unica acao principal: revisar o que ja esta vencido.",
      due: "Vencidas",
      total: "Total na fila",
      suggestedBatch: "Lote sugerido"
    },
    filters: {
      title: "Refinar fila",
      subtitle: "Ajuste o recorte sem transformar a revisao em um painel pesado.",
      certification: "Certificacao",
      state: "Recorte",
      refine: "Refino",
      bookmarksOnly: "So marcadas",
      notesOnly: "So com nota"
    },
    priorityCard: {
      title: "Itens priorizados",
      subtitle: "Os itens mais sensiveis ficam no topo."
    },
    empty: "Nenhum item de revisao pendente no momento.",
    queueState: {
      overdue: "atrasada ha {days} dia(s)",
      dueToday: "vence hoje",
      atRisk: "vence em ate 48h",
      mastered: "ja consolidada",
      scheduledFor: "agendada para {date}",
      scheduled: "agendada"
    }
  },
  settings: {
    header: {
      title: "Configuracoes",
      subtitle: "Conta, sincronizacao e o seu caderno pessoal em um lugar separado."
    },
    notices: {
      loggedOutTitle: "Sessao encerrada",
      loggedOutMessage: "Voce voltou ao modo local deste dispositivo.",
      logoutFailureTitle: "Falha ao sair"
    }
  },
  account: {
    card: {
      title: "Conta e sincronizacao",
      subtitle: "Sincronize progresso entre dispositivos sem perder o fallback local."
    },
    summary: {
      ariaLabel: "Resumo da conta",
      bookmarks: "Bookmarks",
      notes: "Notas",
      dueReviews: "Revisoes vencidas"
    },
    lists: {
      updatedAt: "Atualizado em {date}",
      recentBookmarks: "Bookmarks recentes",
      recentNotes: "Notas recentes",
      reviewQueue: "Fila de revisao",
      noBookmarks: "Nenhum bookmark salvo ainda.",
      noNotes: "Nenhuma nota salva ainda.",
      noDueReviews: "Nenhuma revisao vencida no momento."
    },
    guest: {
      localModeTitle: "Modo local ativo",
      localModeMessage:
        "Voce ainda pode usar o dispositivo atual, mas o progresso nao esta sincronizado entre navegadores.",
      signInTitle: "Autentique para consolidar o historico",
      signInMessage:
        "Ao entrar, o backend associa sessoes, bookmarks, notas e revisoes deste dispositivo a sua conta."
    },
    user: {
      roleLabel: "papel",
      sinceLabel: "desde"
    }
  },
  insights: {
    empty: {
      exams: "Nenhum simulado concluido ainda. Crie um primeiro bloco para popular esse painel.",
      study: "Nenhum bloco de estudo concluido ainda.",
      weakAreas: "Sem historico suficiente para detectar lacunas ainda."
    },
    titles: {
      weakAreas: "Lacunas e dependencia por area",
      weakAreasSubtitle: "Esse bloco traduz o historico atual em prioridade de estudo por certificacao.",
      queueAndActivity: "Fila de revisao e atividade",
      queueAndActivitySubtitle: "Visibilidade rapida do que esta pendente e do que ja foi estudado.",
      latestExams: "Ultimos simulados",
      latestStudy: "Ultimos blocos de estudo"
    },
    labels: {
      recentErrors: "{ratio}% de erros recentes",
      focus: "Foco",
      dueReviews: "Revisoes vencidas",
      recentExams: "Simulados recentes",
      studyBlocks: "Blocos de estudo",
      mixedExam: "Simulado misto",
      mixedStudy: "Bloco misto",
      correctAnswers: "corretas",
      strategy: "estrategia",
      reviewedOn: "revisado em {date}"
    }
  },
  history: {
    errors: {
      loadHistory: "Nao foi possivel carregar o historico agora.",
      partialLoad: "Alguns blocos falharam ao carregar: {items}."
    },
    failedAreas: {
      exams: "provas",
      examSessions: "simulados",
      study: "estudo",
      weekly: "analise semanal",
      reviewQueue: "fila de revisao"
    },
    header: {
      title: "Historico e analises",
      subtitle: "Sessoes, revisao e ritmo semanal separados por contexto."
    },
    filters: {
      title: "Filtros",
      subtitle: "Refine a leitura sem transformar tudo em um megapainel.",
      exam: "Prova",
      minimumScore: "Nota minima",
      search: "Busca"
    },
    tabs: {
      sessions: "Sessoes",
      review: "Revisao",
      weeks: "Semanas"
    }
  },
  results: {
    errors: {
      loadResult: "Nao foi possivel carregar o resultado desta sessao.",
      bannerTitle: "Nao foi possivel carregar o resultado",
      missingReview: "A sessao nao retornou dados de revisao."
    },
    insights: {
      answered: "Respondidas: {count}",
      accuracy: "Precisao: {value}%",
      averagePerQuestion: "Media por questao: {value}s",
      weakestDomain: "Dominio mais sensivel: {label}",
      weakestDomainWithErrors: "Dominio mais sensivel: {label} ({count} erro(s))",
      reviewDueAfter: "Fila vencida apos o bloco: {count}"
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
      question: "Questao {number}",
      noMetadata: "Sem metadados",
      correct: "Correta",
      wrong: "Errada",
      correctSuffix: " (correta)",
      selectedSuffix: " (sua escolha)"
    },
    header: {
      title: "Resultado da sessao",
      mixedSession: "Sessao mista",
      completedAt: "concluida em {date}"
    },
    summary: {
      studyTitle: "{score} de aproveitamento em estudo",
      examTitle: "{score} de score · prontidao {readiness}",
      strategySubtitle: "Estrategia {strategy}.",
      score: "Score",
      readiness: "Prontidao",
      correct: "Acertos",
      wrong: "Erros",
      answered: "Respondidas",
      questions: "Questoes",
      timeUsed: "Tempo usado",
      timeLimit: "Limite",
      timedOutTitle: "Simulado encerrado por tempo",
      timedOutMessage:
        "O backend aplicou auto-submit quando o cronometro zerou. Revise primeiro os itens errados e os que ficaram sem resposta."
    },
    reviewCard: {
      title: "Revisao guiada",
      subtitle: "Abra cada questao apenas quando precisar revisar o detalhe.",
      questionCount: "{count} questoes",
      empty: "Nenhuma questao foi encontrada para esta revisao."
    }
  },
  runner: {
    header: {
      studyTitle: "Modo Estudo",
      examTitle: "Modo Simulado",
      subtitle: "Pergunta no centro. Ferramentas de apoio ao lado."
    },
    labels: {
      confidence: "Confianca",
      noActiveQuestion: "Nenhuma questao ativa encontrada para esta sessao.",
      tools: "Ferramentas",
      hints: "Hints",
      hintsSubtitle: "Abra apenas quando precisar de um empurrao.",
      notes: "Notas",
      notesSubtitle: "Marque e registre contexto so quando for util.",
      references: "Referencias"
    }
  }
} as const;

export type PtBRMessages = typeof ptBRMessages;
