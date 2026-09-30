export const quizBuilder = {
  metadata: {
    library: "Quizzes ao vivo",
    editor: "Editor de quiz",
    sessions: "Sessões do quiz"
  },
  types: {
    single_choice: { name: "Escolha única", description: "Uma resposta por pessoa; pontua quem escolhe uma correta." },
    multi_choice: { name: "Múltipla resposta", description: "Várias corretas, com crédito parcial ou tudo-ou-nada." },
    true_false: { name: "Verdadeiro ou falso", description: "Duas opções fixas e rápidas de responder." },
    type_answer: { name: "Resposta digitada", description: "Texto curto conferido com as respostas aceitas." },
    poll: { name: "Enquete", description: "Opinião da sala, sem certo ou errado e sem pontos." },
    content: { name: "Slide de conteúdo", description: "Texto de contexto ou instrução entre perguntas." },
    leaderboard: { name: "Placar", description: "Mostra o ranking parcial nesse ponto do quiz." }
  },
  themes: {
    label: "Tema",
    sentinel: { name: "Sentinel", description: "Escuro, sóbrio e com grade de pontos." },
    terminal: { name: "Terminal", description: "Monoespaçado, com scanlines de console." },
    neon_soc: { name: "Neon SOC", description: "Painel de SOC com brilho ciano." },
    aurora: { name: "Aurora", description: "Gradientes suaves em violeta e azul." },
    high_contrast: { name: "Alto contraste", description: "Máxima legibilidade (≥ 7:1), sem fundo animado." }
  },
  license: {
    own: "Própria",
    platform: "Plataforma",
    pending_audit: "Licença em auditoria",
    personal_use: "Uso pessoal"
  },
  sessionStatus: {
    lobby: "No lobby",
    live: "Ao vivo",
    finished: "Encerrada"
  },
  capabilities: {
    loading: "Verificando se você pode apresentar quizzes ao vivo…",
    live_disabled: {
      title: "Quizzes ao vivo estão desligados",
      message: "O recurso ainda não foi ativado neste ambiente. Fale com o administrador para ligar LIVE_ENABLED."
    },
    not_allowlisted: {
      title: "Acesso de apresentador em beta fechado",
      message: "Sua conta ainda não está na lista de apresentadores. Peça acesso ao administrador da plataforma."
    },
    email_not_verified: {
      title: "Confirme seu e-mail para apresentar",
      message: "Por segurança, só contas com e-mail confirmado podem criar salas ao vivo.",
      action: "Ir para as configurações"
    },
    auth_required: {
      title: "Entre para criar quizzes ao vivo",
      message: "Os quizzes ficam vinculados à sua conta para você editar, apresentar e ver resultados depois.",
      action: "Entrar"
    }
  },
  library: {
    context: "Sentinel Arena",
    title: "Quizzes ao vivo",
    description: "Crie quizzes para aulas, treinamentos e eventos. A turma entra pelo QR code, sem cadastro.",
    newQuiz: "Novo quiz",
    loadError: "Não foi possível carregar seus quizzes.",
    count: "{count} quizzes",
    empty: {
      title: "Seu primeiro quiz ao vivo começa aqui",
      message: "Monte perguntas próprias ou traga questões do Banco, escolha um tema para o telão e apresente com PIN e QR code.",
      stepCreate: "Crie o quiz e escolha o tema",
      stepBuild: "Adicione perguntas ou importe do Banco",
      stepPresent: "Publique e apresente: a sala entra pelo celular",
      cta: "Criar meu primeiro quiz"
    },
    card: {
      items: "{count} perguntas",
      itemsOne: "1 pergunta",
      itemsNone: "Sem perguntas",
      published: "v{version}",
      publishedLabel: "Versão publicada {version}",
      neverPublished: "Rascunho",
      unpublished: "Alterações não publicadas",
      lastSession: "Última sessão: {status}, {date}",
      noSessions: "Nunca apresentado",
      updated: "Editado em {date}",
      edit: "Editar",
      present: "Apresentar",
      duplicate: "Duplicar",
      sessions: "Sessões",
      archive: "Arquivar",
      moreActions: "Mais ações para {title}"
    },
    archiveConfirm: {
      title: "Arquivar “{title}”?",
      message: "O quiz sai da biblioteca. Sessões e relatórios já realizados continuam disponíveis.",
      confirm: "Arquivar"
    },
    duplicated: "Cópia criada: “{title}”.",
    archived: "Quiz arquivado.",
    actionError: "A ação não foi concluída."
  },
  create: {
    title: "Novo quiz",
    description: "Dê um nome e escolha como ele vai aparecer no telão. Tudo pode ser mudado depois.",
    titleLabel: "Título",
    titlePlaceholder: "Ex.: Revisão Security+ – Domínio 3",
    titleRequired: "Informe um título.",
    descriptionLabel: "Descrição (opcional)",
    submit: "Criar e editar",
    cancel: "Cancelar"
  },
  editor: {
    back: "Voltar para a biblioteca",
    titleLabel: "Título do quiz",
    loadError: "Não foi possível abrir este quiz.",
    notFound: "Quiz não encontrado ou arquivado.",
    readOnly: "Você pode ver este quiz, mas não editá-lo.",
    settings: "Configurações",
    publish: "Publicar",
    present: "Apresentar",
    sessions: "Sessões",
    versionBadge: "v{version} publicada",
    neverPublished: "Nunca publicado",
    unpublished: "Alterações não publicadas",
    layoutLabel: "Editor do quiz",
    status: {
      idle: "Tudo salvo",
      pending: "Alterações pendentes",
      saving: "Salvando…",
      saved: "Salvo",
      blocked: "Não salvo: corrija os campos destacados",
      error: "Erro ao salvar",
      conflict: "Conflito de versão",
      retry: "Tentar de novo"
    },
    conflict: {
      title: "O quiz foi alterado em outra aba",
      message: "Carregamos a versão mais recente. Suas alterações ainda não salvas foram mantidas: escolha o que fazer com elas.",
      apply: "Aplicar minhas alterações",
      discard: "Descartar as minhas",
      dismiss: "Entendi"
    },
    mutationError: "Não foi possível concluir: {message}"
  },
  rail: {
    title: "Perguntas",
    count: "{count} de {max}",
    add: "Adicionar pergunta",
    fromBank: "Do Banco",
    empty: "Nenhuma pergunta ainda. Adicione a primeira ou traga do Banco de Questões.",
    listLabel: "Perguntas do quiz. Use os botões mover para cima e para baixo ou arraste para reordenar.",
    itemLabel: "Pergunta {position}: {type}",
    moveUp: "Mover pergunta {position} para cima",
    moveDown: "Mover pergunta {position} para baixo",
    moved: "Pergunta movida para a posição {position} de {total}.",
    delete: "Excluir pergunta {position}",
    duplicate: "Duplicar pergunta {position}",
    deleteConfirm: {
      title: "Excluir a pergunta {position}?",
      message: "A pergunta sai deste rascunho. Versões já publicadas não mudam.",
      confirm: "Excluir"
    },
    noPrompt: "Sem enunciado",
    bank: "Banco",
    review: "Revisar",
    issues: "{count} pendências",
    limitReached: "Limite de {max} perguntas atingido."
  },
  typePicker: {
    title: "Adicionar pergunta",
    description: "Escolha o formato. Você pode ajustar tudo depois.",
    scored: "Vale pontos",
    notScored: "Sem pontos"
  },
  preview: {
    label: "Prévia do telão",
    hint: "Como a sala verá esta pergunta no projetor, no tema escolhido.",
    promptPlaceholder: "O enunciado aparece aqui",
    optionPlaceholder: "Opção {letter}",
    noTimer: "Sem cronômetro",
    seconds: "{count} s",
    points: "{count}× pontos",
    noPoints: "Sem pontos",
    typeAnswer: "Os participantes digitam a resposta no celular",
    content: "Slide de conteúdo",
    leaderboard: "Placar parcial",
    leaderboardHint: "O ranking atual aparece aqui durante a sessão.",
    correct: "correta",
    empty: "Selecione ou adicione uma pergunta para ver a prévia.",
    question: "Pergunta {position} de {total}"
  },
  properties: {
    label: "Propriedades da pergunta",
    type: "Formato",
    prompt: "Enunciado",
    promptHint: "Até 120 caracteres fica legível no telão; o máximo é 400.",
    counter: "{count} de {max}",
    counterWarn: "Longo para o telão: acima de {warn} caracteres fica difícil de ler.",
    counterBlock: "Acima do limite de {max} caracteres. Encurte para salvar.",
    options: "Alternativas",
    optionsHintSingle: "Os participantes escolhem uma. Marque pelo menos uma correta; se marcar mais de uma, qualquer uma delas vale.",
    optionsHintMulti: "Os participantes marcam todas que acharem certas. Marque pelo menos uma correta.",
    optionsHintTrueFalse: "As duas opções são fixas. Marque qual é a correta.",
    optionsHintPoll: "Enquete não tem resposta certa; cada opção mostra quantos votaram.",
    optionLabel: "Texto da alternativa {letter}",
    optionPlaceholder: "Alternativa {letter}",
    correct: "Correta",
    trueLabel: "Verdadeiro",
    falseLabel: "Falso",
    markCorrect: "Alternativa {letter} correta",
    removeOption: "Remover alternativa {letter}",
    addOption: "Adicionar alternativa",
    optionsLimit: "De {min} a {max} alternativas.",
    allOrNothing: "Tudo ou nada",
    allOrNothingHint: "Só pontua quem marcar exatamente as corretas. Desligado, há crédito parcial.",
    allowMultiple: "Permitir escolher várias opções",
    accepted: "Respostas aceitas",
    acceptedHint: "Maiúsculas, acentos, espaços e pontuação final são ignorados. Até 10 respostas de 60 caracteres.",
    acceptedPlaceholder: "Digite e pressione Enter",
    acceptedAdd: "Adicionar",
    acceptedRemove: "Remover a resposta “{answer}”",
    acceptedDuplicate: "Essa resposta já está na lista (ignorando maiúsculas e acentos).",
    acceptedMax: "Máximo de 10 respostas aceitas.",
    acceptedTooLong: "Cada resposta aceita tem no máximo 60 caracteres.",
    body: "Texto do slide",
    bodyHint: "Até 1000 caracteres. Use para contexto, instruções ou um intervalo.",
    leaderboardInfo: "Este item mostra o placar parcial. Não há campos para preencher.",
    timing: "Tempo e pontos",
    timeLimit: "Tempo para responder",
    timer: "Com cronômetro",
    noTimer: "Sem cronômetro",
    noTimerHint: "Sem cronômetro a pontuação é fixa e a pergunta fecha quando você mandar.",
    seconds: "Segundos",
    secondsRange: "Entre {min} e {max} segundos.",
    points: "Pontos",
    pointsOptions: {
      "0": "Sem pontos",
      "1": "Padrão",
      "2": "Dobro"
    },
    extra: "Explicação e notas",
    explanation: "Explicação (“Por quê?”)",
    explanationHint: "Aparece no reveal, se a opção estiver ligada nas configurações.",
    notes: "Notas do apresentador",
    notesHint: "Só você vê, na tela de apresentação.",
    bankReadOnly: {
      title: "Questão do Banco",
      message: "O conteúdo vem do Banco de Questões e não pode ser editado aqui. Ajuste tempo e pontos à vontade."
    },
    review: {
      title: "Esta pergunta precisa de revisão",
      message: "Confira enunciado e gabarito. O quiz só pode ser publicado depois que todas as perguntas forem revisadas.",
      action: "Marcar como revisada"
    },
    source: "{certification} · {domain}",
    empty: "Selecione uma pergunta para editar."
  },
  issues: {
    prompt_required: "Escreva o enunciado.",
    prompt_too_long: "O enunciado passa de 400 caracteres.",
    option_text_required: "Preencha o texto da alternativa.",
    option_too_long: "A alternativa passa de 120 caracteres.",
    options_count: "Use de 2 a 6 alternativas.",
    no_correct: "Marque pelo menos uma alternativa correta.",
    true_false_exactly_one: "Marque exatamente uma opção correta.",
    accepted_required: "Adicione pelo menos uma resposta aceita.",
    accepted_too_long: "Uma resposta aceita passa de 60 caracteres.",
    accepted_too_many: "Use no máximo 10 respostas aceitas.",
    body_too_long: "O texto do slide passa de 1000 caracteres."
  },
  settings: {
    title: "Configurações do quiz",
    description: "Valem para as próximas sessões depois de publicar.",
    general: "Geral",
    titleLabel: "Título",
    descriptionLabel: "Descrição",
    language: "Idioma",
    languages: {
      "pt-BR": "Português (Brasil)",
      en: "Inglês"
    },
    scoring: "Pontuação",
    scoringOptions: {
      speed: { name: "Por velocidade", description: "Até 1000 pontos; quem responde certo mais rápido ganha mais." },
      fixed: { name: "Fixa", description: "Acertou, ganhou os mesmos pontos, sem pressa." },
      none: { name: "Sem pontos", description: "Sem placar: bom para diagnóstico e enquetes." }
    },
    gameplay: "Ritmo",
    readingPhase: "Tempo de leitura (s)",
    readingPhaseHint: "O enunciado aparece sozinho antes de liberar as respostas. De 0 a 10.",
    grace: "Tolerância de rede (ms)",
    graceHint: "Aceita respostas que chegam logo após o prazo. De 0 a 1500.",
    leaderboardEvery: "Placar a cada N perguntas",
    leaderboardEveryHint: "0 mostra o placar só no fim. De 0 a 20.",
    display: "No telão e no celular",
    streak: "Bônus por sequência de acertos",
    streakHint: "+100 por acerto consecutivo, até +500.",
    liveDistribution: "Mostrar distribuição ao vivo no telão",
    showCorrect: "Mostrar no celular se a pessoa acertou",
    showExplanation: "Mostrar a explicação no reveal",
    music: "Música e efeitos sonoros",
    rangeError: "Use um valor entre {min} e {max}.",
    done: "Concluir"
  },
  bank: {
    title: "Adicionar do Banco de Questões",
    description: "O gabarito fica oculto aqui e aparece no editor depois de adicionar.",
    search: "Buscar",
    searchPlaceholder: "Palavra-chave, sigla, conceito…",
    certification: "Certificação",
    domain: "Domínio",
    difficulty: "Dificuldade",
    any: "Todas",
    difficulties: {
      Easy: "Fácil",
      Medium: "Média",
      Hard: "Difícil"
    },
    onlyGuest: "Somente elegíveis para convidados",
    onlyGuestHint: "Questões que podem aparecer em salas com participantes sem login.",
    results: "{count} questões encontradas",
    selected: "{count} selecionadas",
    add: "Adicionar {count}",
    addNone: "Selecione questões",
    guestEligible: "Elegível para convidados",
    loginOnly: "Somente participantes logados",
    unavailable: "Indisponível: {reason}",
    multiSelect: "Múltipla resposta",
    convertsTo: "Entra como {type}",
    notConvertible: "Formato não suportado ao vivo",
    select: "Selecionar questão",
    empty: "Nenhuma questão com esses filtros.",
    loadError: "Não foi possível buscar no Banco.",
    page: "Página {page} de {pages}",
    previous: "Anterior",
    next: "Próxima",
    rejectedTitle: "{count} questões não foram adicionadas",
    added: "{count} questões adicionadas ao quiz.",
    close: "Fechar",
    reasons: {
      inactive: "questão desativada",
      unsupported_format: "formato não suportado ao vivo",
      unsupported: "formato não suportado ao vivo",
      license_personal_use: "licença de uso pessoal",
      too_few_options: "menos de 2 alternativas",
      too_many_options: "mais de 6 alternativas",
      not_found: "questão não encontrada",
      already_in_quiz: "já está no quiz"
    }
  },
  publish: {
    title: "Publicar versão",
    description: "A versão publicada é um retrato fixo: as sessões usam exatamente o que estiver nela.",
    ready: "Tudo pronto para publicar {count} perguntas.",
    publishing: "Publicando…",
    submit: "Publicar agora",
    success: "Versão {version} publicada",
    successMessage: "As próximas sessões usam esta versão. Continue editando: nada muda até a próxima publicação.",
    warningsTitle: "Avisos (não impedem a publicação)",
    issuesTitle: "Corrija antes de publicar",
    issuesMessage: "Selecione um item para ir direto à pergunta.",
    goTo: "Pergunta {position}",
    quizLevel: "Quiz",
    presentNow: "Apresentar agora",
    close: "Fechar",
    nothingScored: "Nenhuma pergunta vale pontos: o placar ficará zerado."
  },
  present: {
    title: "Apresentar ao vivo",
    description: "Uma sala nova é aberta com PIN de 6 dígitos e QR code. A tela de apresentação abre em seguida.",
    mustPublish: {
      title: "Há alterações não publicadas",
      message: "A sessão usa a última versão publicada. Publique agora para apresentar o que está no editor.",
      never: "Este quiz ainda não foi publicado. Publique para poder apresentar."
    },
    publishAndPresent: "Publicar e apresentar",
    presentPublished: "Apresentar v{version}",
    submit: "Abrir sala",
    guests: "Permitir convidados sem login",
    guestsHint: "Participantes entram só com um apelido. Questões com licença restrita exigem login.",
    preset: "Formato",
    presets: {
      turma: { name: "Turma", description: "Aula ou treinamento: ritmo guiado, até algumas dezenas de pessoas." },
      evento: { name: "Evento", description: "Palestra ou auditório: sala grande, entrada rápida." }
    },
    audience: "Público",
    audiences: {
      adulto: "Adultos",
      misto: "Misto",
      infantojuvenil: "Infantojuvenil (apelidos gerados automaticamente)"
    },
    maxParticipants: "Máximo de participantes",
    maxParticipantsHint: "Até {max}.",
    rehearsal: "Ensaio",
    rehearsalHint: "Sessão privada para testar o ritmo antes de apresentar de verdade.",
    bots: "Bots",
    botsHint: "De 0 a 200. Bots entram na sala e respondem sozinhos; nunca entram em relatórios nem no CSV.",
    botsError: "Use um número inteiro de 0 a 200.",
    licenseBlocked: {
      title: "Algumas perguntas não podem ir para convidados",
      message: "A licença destas questões exige participantes logados. Você pode exigir login para esta sala.",
      item: "Pergunta {position}",
      blockedMessage: "A licença destas questões não permite uso em sessões ao vivo. Remova-as do quiz e publique de novo.",
      requireLogin: "Exigir login e abrir sala"
    },
    notPublished: "Publique o quiz antes de apresentar.",
    error: "Não foi possível abrir a sala."
  },
  sessions: {
    context: "Sessões",
    title: "Sessões de “{title}”",
    description: "Histórico completo: nenhuma sessão some da lista.",
    back: "Voltar ao editor",
    empty: "Este quiz ainda não foi apresentado.",
    loadError: "Não foi possível carregar as sessões.",
    columns: {
      date: "Data",
      status: "Status",
      version: "Versão",
      code: "PIN",
      participants: "Participantes",
      actions: "Ações"
    },
    results: "Resultados",
    resume: "Voltar à apresentação",
    end: "Encerrar",
    qr: "QR code",
    endConfirm: {
      title: "Encerrar a sessão {code}?",
      message: "Ninguém mais consegue entrar ou responder. O relatório fica disponível em seguida.",
      confirm: "Encerrar sessão"
    },
    guests: "Com convidados",
    loginOnly: "Somente logados",
    rehearsal: "Ensaio",
    rehearsalHint: "Sessão de ensaio: bots não entram no relatório."
  }
} as const;
