export const review = {
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
  },
  activeFilters: {
    title: "Filtros ativos",
    subtitle: "Este bloco veio de um link de revisão focada por domínio.",
    removeDomain: "Remover filtro {domain}"
  }
} as const;
