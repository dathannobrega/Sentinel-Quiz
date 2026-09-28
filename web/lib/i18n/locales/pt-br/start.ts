export const start = {
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
} as const;
