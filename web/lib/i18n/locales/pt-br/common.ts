export const common = {
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
    loading: "Carregando...",
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
} as const;
