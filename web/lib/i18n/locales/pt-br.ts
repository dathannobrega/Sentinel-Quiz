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
      upToDate: "Em dia",
      closed: "Fechado"
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
      authFailure: "Falha de autenticação",
      requiredFields: "Campos obrigatórios",
      invalidPassword: "Senha inválida",
      missingToken: "Token ausente"
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
    },
    sessions: {
      title: "Resumo",
      subtitle: "Leitura rápida do volume recente.",
      filteredExams: "Simulados filtrados",
      examAverage: "Média dos simulados",
      studyAverage: "Média do estudo",
      dueQueue: "Fila vencida",
      totalQueue: "Fila total",
      nextReview: "Próxima revisão",
      examsTitle: "Simulados",
      examsSubtitle: "Cada item abre a revisão da sessão correspondente.",
      studiesTitle: "Estudo",
      studiesSubtitle: "Blocos de estudo e domínios mais sensíveis."
    },
    reviewPanel: {
      weeklyGoalTitle: "Meta semanal",
      weeklyGoalSubtitle: "Um alvo prático para equilibrar estudo novo e revisão.",
      questionGoal: "Meta de questões",
      reviewGoal: "Meta de revisões",
      newSuggested: "Novas sugeridas",
      completion: "Conclusão",
      forecastTitle: "Carga prevista",
      forecastSubtitle: "Antecipe picos antes de virar backlog.",
      dueInSevenDays: "Vencem em 7 dias",
      enteringRisk: "Entram em risco",
      peakDay: "Pico diário",
      pressure: "Pressão",
      queueTitle: "Fila de revisão",
      queueSubtitle: "Os itens com maior pressão de retorno aparecem primeiro."
    },
    weeksPanel: {
      title: "Ritmo semanal",
      subtitle: "Volume, revisões e qualidade por semana."
    }
  },
  auth: {
    errors: {
      authUnavailable: "Não foi possível concluir a autenticação."
    },
    notices: {
      sessionUnavailable: "Sessão indisponível",
      sessionStarted: "Sessão iniciada",
      accountCreated: "Conta criada",
      localMerged: "O progresso local deste dispositivo foi associado à sua conta quando aplicável.",
      loggedOut: "Sessão encerrada",
      localMode: "Você voltou ao modo local deste dispositivo.",
      verificationResent: "Verificação reenviada",
      verificationResentMessage: "Se o email existir e estiver ativo, você receberá um novo link de verificação.",
      resendFailed: "Falha ao reenviar",
      logoutFailed: "Falha ao sair"
    },
    hero: {
      loginEyebrow: "Sessão segura",
      registerEyebrow: "Criação de conta",
      loginTitle: "Entre para sincronizar seu progresso.",
      registerTitle: "Crie sua conta e continue de qualquer dispositivo.",
      lead:
        "A autenticação usa cookie HttpOnly no backend. Quando você entra, o sistema associa histórico local, marcadores, notas e revisões pendentes à sua conta sem expor a sessão em localStorage.",
      benefitsAriaLabel: "Benefícios da conta"
    },
    stats: [
      {
        label: "Sincronização",
        value: "Conta",
        meta: "Histórico, revisão e progresso unificados."
      },
      {
        label: "Segurança",
        value: "HttpOnly",
        meta: "Sessão protegida via cookie e backend tipado."
      },
      {
        label: "Continuidade",
        value: "Auto-merge",
        meta: "O dispositivo atual é consolidado quando aplicável."
      },
      {
        label: "Acesso",
        value: "Web",
        meta: "Pronto para estudo, simulados e revisão guiada."
      }
    ],
    form: {
      loginTitle: "Entrar",
      registerTitle: "Criar conta",
      loginSubtitle: "Use a mesma conta para retomar estudos e simulados em qualquer navegador.",
      registerSubtitle: "Crie uma conta para salvar seu progresso e destravar os fluxos protegidos.",
      requiredMessage: "Preencha email e senha antes de continuar.",
      invalidPasswordMessage: "Use pelo menos 8 caracteres para criar a conta.",
      name: "Nome",
      nameHint: "Opcional. Facilita identificar a conta.",
      email: "Email",
      password: "Senha",
      loginPasswordHint: "Use a senha da conta existente.",
      registerPasswordHint: "Mínimo de 8 caracteres.",
      goToRegister: "Ir para cadastro",
      forgotPassword: "Esqueci a senha"
    },
    account: {
      roleLabel: "papel",
      emailVerified: "Email verificado",
      emailPending: "Email pendente"
    },
    flow: {
      title: "O que acontece ao autenticar",
      subtitle: "Fluxo pensado para preservar dados e evitar retrabalho.",
      steps: [
        {
          title: "1. Sessão protegida no backend",
          description:
            "O login estabelece a sessão principal por cookie HttpOnly e mantém o token em memória apenas como compatibilidade transitória."
        },
        {
          title: "2. Merge do progresso local",
          description:
            "Sessões, marcadores, notas e itens da fila de revisão do dispositivo atual podem ser associados à sua conta automaticamente."
        },
        {
          title: "3. Continuidade entre dispositivos",
          description:
            "Depois do login, o dashboard, o histórico e os modos de estudo passam a refletir o escopo da conta."
        }
      ]
    }
  },
  marketing: {
    errors: {
      sessionUnavailable: "Sessão indisponível",
      checkSession: "Não foi possível verificar a sessão."
    },
    hero: {
      eyebrow: "Security+ e CISSP",
      title: "Treine para Security+ e CISSP com simulados e revisão inteligente.",
      lead:
        "Questões com explicações, modo prova cronometrado, fila de revisão (SRS) e métricas por domínio para atacar seus pontos fracos.",
      chips: ["Sem cartão", "Acesso imediato", "Desktop e celular"]
    },
    howItWorks: {
      title: "Como funciona",
      subtitle: "Fluxo curto, direto e orientado para evolução real.",
      steps: [
        {
          title: "1. Escolha a certificação e o objetivo",
          description: "Study ou Exam, com filtros por domínio, dificuldade e foco atual."
        },
        {
          title: "2. Responda e entenda o porquê",
          description: "Explicações, nível de confiança, dicas graduais e referências oficiais."
        },
        {
          title: "3. Revise o que você erra",
          description: "Fila inteligente, análises por domínio e progresso semanal."
        }
      ]
    },
    whyItWorks: {
      title: "Por que isso funciona",
      subtitle: "Treino, diagnóstico e reforço no mesmo loop.",
      items: [
        ["Simulados cronometrados", "Tempo real, pausa controlada e revisão final."],
        ["Revisão inteligente (SRS)", "Volte exatamente no que você erra ou acerta sem segurança."],
        ["Análise por domínio", "Veja rapidamente onde estão suas lacunas."],
        ["Explicações completas", "Não é só letra certa: o sistema orienta o raciocínio."],
        ["Notas e favoritos", "Construa sua trilha pessoal de estudo."],
        ["Tutor IA opcional", "Use quando precisar destravar uma dúvida pontual."]
      ]
    },
    preview: {
      title: "Preview do produto",
      subtitle: "Tudo que você precisa, sem distração.",
      cards: [
        {
          title: "Dashboard",
          subtitle: "Domínios fracos, meta semanal e retomada rápida.",
          chips: ["áreas fracas", "ritmo", "retenção"]
        },
        {
          title: "Runner de simulado",
          subtitle: "Timer, navegação e foco total na execução.",
          chips: ["tempo real", "pausa", "resultado"]
        },
        {
          title: "Revisão",
          subtitle: "Fila, explicação e contexto de estudo.",
          chips: ["SRS", "dicas", "referências"]
        }
      ]
    },
    offer: {
      title: "Oferta",
      subtitle: "Acesso beta: gratuito por tempo limitado.",
      items: [
        ["Beta gratuito", "Study mode, exam mode, revisão básica e análises principais."],
        ["Evolução planejada", "Análises completas, simulados adaptativos mais profundos e recursos premium."]
      ]
    },
    faq: {
      title: "FAQ",
      subtitle: "Objetivo, independente e transparente.",
      items: [
        ["Isso é dump?", "Não. O foco é treino com explicação, dicas e revisão para entender o conteúdo."],
        ["É afiliado à CompTIA ou ISC2?", "Não. É uma plataforma independente."],
        ["As questões são atualizadas?", "Sim. O catálogo é versionado e revisado continuamente."],
        ["Posso estudar no celular?", "Sim. O fluxo foi desenhado para desktop e mobile."],
        ["Como funcionam metas e revisão?", "O sistema registra seu desempenho, monta fila de reforço e sugere a próxima ação."]
      ]
    },
    trust: {
      title: "Confiança e transparência",
      subtitle: "Sem exagero de promessa e sem dependência de decoreba.",
      chips: ["Dados protegidos", "Sessão segura", "Sem spam", "Plataforma independente"]
    },
    cta: {
      eyebrow: "Pronto para começar",
      title: "Comece hoje e veja seu progresso em 7 dias."
    }
  },
  password: {
    forgot: {
      title: "Recuperar senha",
      subtitle: "Solicite um link seguro para redefinir sua senha.",
      emailRequiredTitle: "Email obrigatório",
      emailRequiredMessage: "Informe o email da conta para continuar.",
      requestedTitle: "Solicitação registrada",
      requestedMessage: "Se a conta existir, um email com o link de redefinição foi enviado.",
      failedTitle: "Falha ao solicitar",
      failedMessage: "Não foi possível iniciar a recuperação.",
      emailLabel: "Email",
      submit: "Enviar link",
      backToLogin: "Voltar ao login"
    },
    reset: {
      title: "Definir nova senha",
      subtitle: "Use o link recebido por email para concluir a redefinição.",
      missingTokenMessage: "O link de redefinição está incompleto.",
      invalidPasswordMessage: "Use pelo menos 8 caracteres.",
      updatedTitle: "Senha atualizada",
      updatedMessage: "Sua senha foi redefinida. Entre novamente com a nova credencial.",
      failedTitle: "Falha ao redefinir",
      failedMessage: "Não foi possível redefinir a senha.",
      passwordLabel: "Nova senha",
      passwordHint: "Mínimo de 8 caracteres.",
      submit: "Atualizar senha"
    },
    verify: {
      title: "Verificação de email",
      subtitle: "Confirmação de identidade para fortalecer a conta.",
      missingTokenMessage: "O link de verificação está incompleto.",
      successTitle: "Email verificado",
      successMessage: "O email {email} foi validado com sucesso.",
      failedTitle: "Falha na verificação",
      failedMessage: "Não foi possível validar o email.",
      goToLogin: "Ir para login"
    }
  },
  admin: {
    header: {
      title: "Sentinel Quiz Admin",
      subtitle:
        "Painel editorial migrado para Next.js com CRUD real, preview de payload e acesso seguro por sessão."
    },
    notices: {
      editorialAccess: "Acesso editorial",
      status: "Status"
    },
    access: {
      title: "Acesso e manutenção",
      subtitle: "Todas as operações editoriais exigem uma sessão autenticada com papel admin.",
      refresh: "Atualizar",
      reimportJson: "Reimportar JSONs",
      exportDatabase: "Exportar banco",
      accessControlTitle: "Controle de acesso",
      accessControlMessage:
        "O backend aceita apenas usuários admin autenticados. O painel não usa mais chave estática nem header editorial.",
      quickSummaryTitle: "Resumo rápido",
      summaryAriaLabel: "Resumo editorial",
      exams: "Provas",
      questions: "Questões",
      completedSessions: "Sessões concluídas"
    },
    insights: {
      title: "Insights editoriais",
      subtitle: "Veja onde o banco está mais sensível antes de editar ou publicar.",
      captureSnapshot: "Registrar snapshot",
      summaryAriaLabel: "Resumo de sinais editoriais",
      questionsWithSignal: "Questões com sinal",
      totalAttempts: "Tentativas totais",
      averageError: "Erro médio",
      reviewPressure: "Pressão de revisão",
      snapshots: "Snapshots",
      latestSnapshot: "Último snapshot",
      hardestQuestions: "Questões mais sensíveis",
      weakestDomains: "Domínios mais fracos",
      weakestExams: "Provas com maior atrito",
      noSignal: "Ainda não há sinal suficiente para destacar questões.",
      noDomain: "Sem domínio",
      noRelevantDomains: "Sem domínios com histórico relevante ainda.",
      noExamFriction: "Sem prova com atrito consolidado ainda."
    },
    browser: {
      title: "Explorar questões",
      subtitle: "Filtre, navegue e carregue uma questão sem sair da mesma tela.",
      newQuestion: "Nova questão",
      exam: "Prova",
      search: "Buscar",
      searchHint: "Procure por ID, domínio, certificação ou trecho do enunciado.",
      refreshingList: "Atualizando lista...",
      foundCount: "{count} questão(ões) encontradas.",
      listAriaLabel: "Lista de questões",
      draftVersion: "rascunho v{version}",
      publishedVersion: "publicada v{version}",
      correctOptions: "{correct}/{count} corretas",
      multi: "multi",
      single: "single",
      draft: "rascunho",
      empty:
        "Nenhuma questão carregada. Revise a permissão editorial ou ajuste os filtros para continuar."
    },
    examsManager: {
      title: "Cadastro de prova",
      subtitle: "Atualize o catálogo de provas sem sair do editor.",
      registeredExams: "Provas cadastradas",
      examId: "ID da prova",
      questionCount: "Qtd. de questões",
      titleLabel: "Título",
      source: "Fonte",
      sourceHint: "Ex.: questions/securityplus.json",
      noticeTitle: "Prova",
      saveExam: "Salvar prova",
      clear: "Limpar"
    },
    editor: {
      title: "Editor de questão",
      subtitle:
        "Edite tudo em um fluxo único: metadados, alternativas, justificativa, referências e preview do payload.",
      noticeTitle: "Questão",
      validationTitle: "Validação",
      load: "Carregar",
      duplicate: "Duplicar",
      delete: "Excluir"
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
    errors: {
      loadSession: "Não foi possível carregar esta sessão.",
      openSessionTitle: "Não foi possível abrir a sessão",
      examPausedTitle: "Simulado pausado",
      examPausedMessage: "As respostas ficam bloqueadas enquanto a pausa estiver ativa."
    },
    header: {
      studyTitle: "Modo Estudo",
      examTitle: "Modo Simulado",
      subtitle: "Pergunta no centro. Ferramentas de apoio ao lado."
    },
    questionCard: {
      title: "Questão {current} de {total}",
      singleSelect: "Selecione uma alternativa.",
      multiSelect: "Selecione todas as alternativas corretas.",
      optionsAriaLabel: "Alternativas",
      answered: "{count} respondidas",
      examSummary: "{correct} acertos · {wrong} erros",
      paused: "Pausado",
      time: "Tempo"
    },
    feedback: {
      correct: "Resposta correta",
      wrong: "Resposta incorreta",
      missingJustification: "Sem justificativa cadastrada para esta questão. Revise o tópico e siga para a próxima."
    },
    labels: {
      confidence: "Confiança",
      noActiveQuestion: "Nenhuma questão ativa encontrada para esta sessão.",
      tools: "Ferramentas",
      hints: "Dicas",
      hintsSubtitle: "Abra apenas quando precisar de um empurrão.",
      notes: "Notas",
      notesSubtitle: "Marque e registre contexto só quando for útil.",
      references: "Referências",
      referencesHintAria: "Referências sugeridas pela dica",
      referencesOfficialAria: "Referências oficiais",
      questionToolsAria: "Ferramentas da questão",
      level: "Nível {level}",
      openExcerpt: "Abrir trecho",
      reviewLater: "Marcar para revisar depois",
      note: "Nota",
      save: "Salvar",
      reload: "Recarregar",
      examFocusOnly: "No simulado, mantenha o foco na pergunta. A revisão detalhada aparece no resultado final."
    },
    notices: {
      loadingStudyState: "Carregando status de estudo...",
      savingStudyState: "Salvando status de estudo...",
      syncedAt: "Sincronizado em {date} ({scope}).",
      noSavedNotes: "Sem anotações salvas ainda ({scope}).",
      savedAt: "Salvo em {date} ({scope}).",
      syncedStatus: "Status sincronizado ({scope}).",
      saveFailed: "Não foi possível salvar: {error}",
      examPaused: "Simulado pausado. O cronômetro ficou congelado dentro do limite configurado.",
      examResumed: "Simulado retomado. O cronômetro voltou a contar."
    },
    studyState: {
      pendingChanges: "Alterações pendentes..."
    },
    hints: {
      hintButton: "Dica {level}"
    },
    actions: {
      confirmAnswer: "Confirmar resposta"
    },
    liveFeedback: {
      remaining: "Restantes: {count}",
      currentStreak: "Streak atual: {count}",
      uncertainCorrect: "Acerto inseguro: segue como sinal de reforço.",
      nextReview: "Próxima revisão: {date}",
      dueQueue: "Fila vencida: {count}"
    }
  }
} as const;

export type PtBRMessages = typeof ptBRMessages;
