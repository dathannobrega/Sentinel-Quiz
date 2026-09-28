export const runner = {
  errors: {
    loadSession: "Não foi possível carregar esta sessão.",
    openSessionTitle: "Não foi possível abrir a sessão",
    examPausedTitle: "Simulado pausado",
    examPausedMessage: "As respostas ficam bloqueadas enquanto a pausa estiver ativa."
  },
  navigator: {
    title: "Navegação",
    examTitle: "Navegador da prova",
    minimalSubtitle: "Fluxo enxuto, sem recursos pedagógicos.",
    examSubtitle: "Vá e volte livremente antes de enviar.",
    pending: "Pendentes: {count}",
    flagged: "Marcadas: {count}",
    loading: "Carregando status da prova...",
    empty: "Sem dados do navegador ainda."
  },
  examDay: {
    tag: "Exam day",
    activeTitle: "Modo prova ativo",
    activeMessage: "Correção instantânea, tutor, referências e saídas rápidas foram reduzidos para simular o dia da prova.",
    answerRecordedTitle: "Resposta registrada",
    answerRecordedMessage: "No modo prova, o gabarito e a análise detalhada só aparecem depois do envio final."
  },
  tags: {
    markedForReview: "Marcada para revisão"
  },
  actions: {
    unmarkReview: "Desmarcar revisão",
    markReview: "Marcar revisão",
    previous: "Anterior",
    confirmAnswer: "Confirmar resposta"
  },
  tutor: {
    title: "Tutor da questão",
    subtitle: "Disponível após responder, sem sair da prova.",
    explain: "Me explique",
    whyWrong: "Por que errei?",
    reviewTopic: "Revisar assunto"
  },
  issueReport: {
    title: "Reportar questão",
    subtitle: "Isso alimenta o backlog editorial.",
    category: "Categoria",
    detail: "Detalhe",
    clarity: "Clareza",
    answerKey: "Gabarito",
    explanation: "Explicação",
    reference: "Referência",
    send: "Enviar reporte",
    success: "Reporte enviado para o backlog editorial."
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
  liveFeedback: {
    remaining: "Restantes: {count}",
    currentStreak: "Streak atual: {count}",
    uncertainCorrect: "Acerto inseguro: segue como sinal de reforço.",
    nextReview: "Próxima revisão: {date}",
    dueQueue: "Fila vencida: {count}"
  }
} as const;
