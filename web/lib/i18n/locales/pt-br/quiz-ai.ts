export const quizAi = {
  badge: {
    label: "Gerado por IA",
    short: "IA"
  },
  entry: {
    generate: "Gerar com IA",
    running: "IA gerando"
  },
  empty: {
    title: "Comece seu quiz em segundos",
    message: "Descreva um tema ou cole um texto: a IA escreve rascunhos de perguntas e você escolhe o que entra, revisando antes de publicar.",
    messageNoAi: "Monte perguntas próprias ou sorteie questões revisadas do Banco com a cobertura que você quiser.",
    steps: {
      describe: "Descreva o tema, a certificação ou cole um texto",
      review: "Revise os rascunhos com os alertas do revisor automático",
      present: "Publique e apresente para a turma"
    },
    add: "Escrever uma pergunta",
    bank: "Trazer do Banco"
  },
  dialog: {
    title: "Gerar com IA",
    description: "A IA escreve rascunhos; nada entra no quiz sem a sua escolha, e cada pergunta passa pela sua revisão antes de publicar.",
    tabsLabel: "Como gerar as perguntas",
    tabs: {
      topic: "Por tema",
      source: "A partir de um texto",
      bank: "Sortear do banco"
    },
    noAi: "sem IA"
  },
  unavailable: {
    ai_disabled: {
      title: "A IA de criação está desligada",
      message: "O recurso ainda não foi ativado neste ambiente (AI_AUTHORING_ENABLED)."
    },
    not_allowed: {
      title: "Sua conta não pode usar a IA de criação",
      message: "Peça acesso ao administrador da plataforma."
    },
    quota_exhausted: {
      title: "Seus créditos de IA de hoje acabaram",
      message: "A cota diária renova à meia-noite (UTC)."
    },
    unavailable: {
      title: "A IA de criação está indisponível agora",
      message: "Tente de novo em alguns minutos."
    },
    bankStillWorks: "O sorteio do banco continua disponível, porque não usa IA."
  },
  credits: {
    remaining: "{remaining} de {limit} créditos hoje",
    unlimited: "Créditos de IA ilimitados",
    cost: "Custo: {cost} créditos",
    after: "restarão {after}",
    insufficient: "Você tem {remaining} créditos hoje. Reduza para {max} perguntas ou menos.",
    meterLabel: "Créditos de IA usados hoje"
  },
  form: {
    optional: "(opcional)",
    counter: "{count} / {max}",
    tooLong: "{count} caracteres acima do limite.",
    tooShort: "Faltam {count} caracteres para o mínimo de {min}.",
    errorsTitle: "Confira antes de gerar:",
    errors: {
      topicOrCertification: "Informe um tema ou escolha uma certificação.",
      topicTooLong: "O tema passou do limite de caracteres.",
      audienceTooLong: "A nota sobre o público passou de 200 caracteres.",
      domainsMax: "Escolha no máximo 10 domínios.",
      sourceTooShort: "Cole pelo menos 200 caracteres de texto.",
      sourceTooLong: "O texto passou do limite de caracteres.",
      titleTooLong: "O assunto do texto passou de 120 caracteres.",
      types: "Escolha pelo menos um tipo de pergunta.",
      count: "Escolha uma quantidade válida de perguntas."
    },
    full: "O quiz já está no limite de perguntas.",
    submit: "Gerar {count} perguntas",
    submitOne: "Gerar 1 pergunta",
    topic: {
      label: "Tema ou objetivo",
      hint: "Descreva o que a turma deve aprender. Seja específico: conceitos, cenário, objetivo do exame.",
      placeholder: "Ex.: controles de acesso em nuvem (objetivo 3.2 do Security+), com foco em IAM e privilégio mínimo"
    },
    certification: {
      label: "Certificação",
      none: "Nenhuma (só o tema)",
      hint: "Usa o blueprint oficial: domínios, nomenclatura e versão atual do exame."
    },
    domains: {
      label: "Domínios",
      hint: "Sem seleção, a IA distribui as perguntas pelo blueprint.",
      selected: "{count} de {max}",
      max: "Limite de {max} domínios atingido.",
      pickCertification: "Escolha uma certificação para ver os domínios."
    },
    audience: {
      label: "Nota sobre o público",
      hint: "Ajuda a calibrar vocabulário e cenários.",
      placeholder: "Ex.: analistas de SOC júnior em onboarding"
    },
    count: {
      label: "Quantidade de perguntas",
      hint: "De 1 a {max}. Cabem mais {capacity} perguntas neste quiz.",
      slider: "Quantidade de perguntas (controle deslizante)"
    },
    level: {
      label: "Nível",
      mixed: "Misto",
      Easy: "Fácil",
      Medium: "Médio",
      Hard: "Difícil"
    },
    types: {
      label: "Tipos de pergunta",
      hint: "Escolha pelo menos um."
    },
    language: {
      label: "Idioma das perguntas",
      ptBR: "Português (Brasil)",
      en: "Inglês"
    },
    source: {
      label: "Texto de origem",
      hint: "Cole de {min} a {max} caracteres: um capítulo, uma política interna, anotações de aula.",
      placeholder: "Cole aqui o conteúdo que a turma estudou…",
      privacy: "Antes de enviar à IA, removemos e-mails, CPFs e telefones. O texto é tratado como conteúdo, nunca como instrução."
    },
    titleHint: {
      label: "Assunto do texto",
      hint: "Ajuda a IA a entender o contexto (ex.: \"Política de senhas 2026\")."
    }
  },
  bank: {
    intro: "Sorteio determinístico, sem IA e sem créditos: escolhe questões revisadas do Banco com a cobertura que você pedir.",
    anyCertification: "Qualquer certificação",
    difficulty: "Dificuldade",
    anyDifficulty: "Qualquer dificuldade",
    domainsHint: "Sem seleção, o sorteio usa todos os domínios da certificação.",
    count: "Quantidade de questões",
    strategy: {
      label: "Estratégia",
      coverage: {
        name: "Cobertura",
        description: "Distribui as questões entre os domínios, como no exame."
      },
      random: {
        name: "Aleatória",
        description: "Sorteia sem equilibrar por domínio."
      }
    },
    onlyGuest: "Só questões liberadas para convidados",
    onlyGuestHint: "Recomendado: as salas aceitam convidados sem login por padrão, e questões de uso restrito bloqueiam a sala.",
    submit: "Sortear {count} questões",
    redraw: "Sortear de novo",
    add: "Adicionar {count} ao quiz",
    result: {
      title: "{count} questões sorteadas",
      noneTitle: "Nenhuma questão encontrada",
      available: "{available} disponíveis com esses filtros",
      coverage: "Cobertura por domínio",
      domainCount: "{count} questões",
      none: "Tente outra dificuldade, menos domínios ou desmarque a restrição para convidados.",
      rejected: "{count} questões não puderam ser adicionadas"
    }
  },
  recent: {
    title: "Gerações recentes",
    count: "{count} gerações neste quiz",
    empty: "Nenhuma geração para este quiz ainda.",
    loadError: "Não foi possível carregar as gerações recentes.",
    credits: "{credits} créditos",
    open: "Abrir geração"
  },
  kind: {
    generate: "Geração por tema",
    from_source: "Geração a partir de texto",
    improve: "Melhoria de pergunta"
  },
  status: {
    queued: "Na fila",
    running: "Gerando",
    succeeded: "Pronto",
    failed: "Falhou",
    degraded: "Modo banco"
  },
  job: {
    back: "Nova geração",
    stepsLabel: "Etapas da geração",
    steps: {
      generating: { name: "Gerando", hint: "A IA escreve os rascunhos" },
      validating: { name: "Validando", hint: "Regras de qualidade e duplicatas" },
      critic: { name: "Revisão do crítico", hint: "Um revisor responde sem ver o gabarito" },
      done: { name: "Pronto", hint: "Você escolhe o que entra" }
    },
    stepState: {
      done: "concluída",
      current: "em andamento",
      pending: "pendente"
    },
    announce: "Etapa atual: {step}",
    progressLabel: "Progresso da geração",
    elapsedLabel: "Tempo decorrido:",
    running: {
      queued: "Na fila: a geração começa em instantes…",
      running: "A IA está escrevendo suas perguntas…"
    },
    writing: "Rascunhos sendo escritos",
    background: "Pode fechar esta janela: a geração continua e fica em Gerações recentes.",
    slow: "Está levando mais que o normal. Você pode fechar a janela e voltar depois; a geração continua.",
    failed: {
      title: "A geração falhou",
      message: "A IA não conseguiu concluir o pedido.",
      refunded: "Os créditos reservados foram estornados.",
      retry: "Tentar de novo"
    },
    finished: {
      queued: "Na fila.",
      running: "Gerando.",
      succeeded: "Geração concluída. Os rascunhos estão prontos para revisão.",
      failed: "A geração falhou.",
      degraded: "A IA está indisponível; há sugestões do banco."
    },
    loadError: "Não foi possível acompanhar a geração.",
    noResult: "Esta geração não tem resultado para mostrar."
  },
  injection: {
    title: "Instruções no texto foram ignoradas",
    message: "O texto parece conter comandos para a IA (como \"ignore as instruções anteriores\"). Eles foram tratados como conteúdo, não como ordens. Revise os rascunhos com atenção redobrada."
  },
  degraded: {
    title: "A IA está indisponível agora",
    message: "Sugerimos estas {count} questões revisadas do banco no lugar.",
    none: "Também não encontramos questões do banco para sugerir. Tente de novo em alguns minutos.",
    add: "Adicionar {count} do banco",
    added: "{count} questões do banco adicionadas ao quiz.",
    partial: "{added} questões adicionadas; {rejected} não puderam entrar."
  },
  review: {
    summary: "{produced} de {requested} rascunhos · {blocked} com erro · {warnings} com aviso",
    listLabel: "Rascunhos gerados",
    selectAllValid: "Selecionar todos os válidos",
    clear: "Limpar seleção",
    selected: "{count} selecionados",
    capacity: "cabem mais {count} no quiz",
    full: "o quiz está cheio",
    add: "Adicionar {count} ao quiz",
    addOne: "Adicionar 1 ao quiz",
    addNone: "Selecione rascunhos",
    appliedTitle: "{count} perguntas adicionadas ao quiz",
    appliedMessage: "Elas entram marcadas como \"Revisar\": aprove cada uma no editor antes de publicar.",
    goToEditor: "Ver no editor",
    emptyTitle: "Nenhum rascunho utilizável",
    empty: "A IA não produziu rascunhos desta vez. Reformule o tema ou escolha outra certificação.",
    itemTitle: "Pergunta gerada por IA: revise antes de publicar",
    itemMessage: "Confira enunciado, alternativas e gabarito. A publicação fica bloqueada até você aprovar."
  },
  draft: {
    label: "Rascunho {number}",
    optionsLabel: "Alternativas",
    correct: "Correta",
    whyWrong: "Por que a {key} está errada",
    explanation: "Explicação",
    acceptedAnswers: "Respostas aceitas",
    seconds: "{seconds} s",
    difficulty: {
      Easy: "Fácil",
      Medium: "Médio",
      Hard: "Difícil"
    },
    state: {
      applied: "Já adicionado",
      blocked: "Bloqueado por erro",
      forced: "Será adicionado mesmo com erro",
      selected: "Selecionado",
      notSelected: "Não selecionado"
    },
    blockedHint: "Este rascunho tem um erro e fica de fora, a menos que você decida adicioná-lo e corrigi-lo no editor.",
    forcedHint: "Você escolheu adicionar mesmo com o erro. Corrija-o no editor antes de publicar.",
    forceAdd: "Adicionar mesmo assim",
    undoForce: "Não adicionar"
  },
  severity: {
    error: "Erro",
    warning: "Aviso"
  },
  issues: {
    schema_invalid: "Formato inválido",
    single_needs_one: "Precisa de exatamente uma correta",
    multi_needs_two: "Múltipla resposta precisa de 2+ corretas e 1+ errada",
    duplicate_option: "Alternativas repetidas",
    all_none_of_above: "\"Todas/nenhuma das anteriores\"",
    negative_stem: "Enunciado negativo sem destaque",
    length_bias: "Correta mais longa que as outras",
    duplicate_bank: "Parecida com uma questão do banco",
    duplicate_batch: "Repetida neste lote",
    unknown_domain: "Domínio fora do blueprint",
    language_mismatch: "Idioma diferente do pedido",
    obsolete_exam: "Cita versão de exame obsoleta",
    key_mismatch: "Gabarito contestado pelo revisor",
    ambiguous: "Questão ambígua"
  },
  critic: {
    title: "Revisor automático",
    confidence: "Confiança {pct}%",
    confidenceLabel: "Confiança do revisor automático",
    agrees: "Sem ver o gabarito, o revisor chegou à mesma resposta ({keys}).",
    noKeys: "nenhuma alternativa",
    none: "Sem revisão automática para este rascunho.",
    needsConfirm: "Ao aprovar no editor, você vai confirmar o gabarito desta questão.",
    flags: {
      key_mismatch: {
        title: "Gabarito contestado",
        message: "O revisor automático, sem ver o gabarito, escolheu {keys} (o gabarito diz {expected})."
      },
      ambiguous: {
        title: "Possível ambiguidade",
        message: "Mais de uma resposta pode ser defendida, ou o revisor ficou com confiança abaixo de 70%."
      },
      factual_issue: {
        title: "Possível erro factual",
        message: "O revisor apontou um fato que pode estar errado ou desatualizado. Confira na fonte."
      }
    }
  },
  improve: {
    title: "Melhorar com IA",
    description: "Receba uma proposta e compare antes de aplicar.",
    actionsLabel: "O que melhorar",
    actions: {
      rewrite: {
        name: "Reescrever para clareza",
        description: "Enunciado mais direto e alternativas sem pistas, mantendo o gabarito."
      },
      distractors: {
        name: "Gerar novos distratores",
        description: "Troca as alternativas erradas por equívocos plausíveis."
      },
      explain: {
        name: "Escrever explicação",
        description: "Explica por que a correta está certa e as outras não."
      }
    },
    instructions: {
      label: "Instruções",
      placeholder: "Ex.: use um cenário de banco; evite siglas sem explicar"
    },
    submit: {
      rewrite: "Reescrever",
      distractors: "Gerar distratores",
      explain: "Escrever explicação"
    },
    running: "Preparando a proposta…",
    ready: "Proposta pronta",
    proposal: "Proposta da IA",
    before: "Antes",
    after: "Depois",
    fields: {
      prompt: "Enunciado",
      options: "Alternativas",
      explanation: "Explicação"
    },
    empty: "(vazio)",
    noChanges: "A IA não sugeriu mudanças para esta pergunta.",
    reviewNote: "Ao aplicar, a pergunta volta para \"Revisar\".",
    apply: "Aplicar",
    discard: "Descartar",
    again: "Tentar de novo",
    applied: "Proposta aplicada. A pergunta voltou para \"Revisar\".",
    failed: "A melhoria falhou",
    unavailableNow: "A IA está indisponível agora. Tente de novo em alguns minutos.",
    noCredits: "Créditos insuficientes para esta melhoria hoje.",
    needsPrompt: "Escreva o enunciado antes de pedir uma melhoria."
  },
  provenance: {
    model: "Modelo: {model}",
    noMeta: "Criada pela IA de autoria",
    show: "Detalhes",
    hide: "Ocultar",
    message: "Esta pergunta veio de uma geração por IA. Os pontos abaixo foram encontrados na validação e pelo revisor automático."
  },
  keyConfirm: {
    label: "Conferi o gabarito desta questão",
    mismatch: "O revisor automático, sem ver o gabarito, escolheu {keys}; o gabarito atual é {expected}.",
    ambiguous: "O revisor achou que mais de uma resposta pode ser defendida.",
    generic: "O revisor automático teve dúvidas sobre esta questão.",
    required: "Marque \"Conferi o gabarito desta questão\" para aprovar esta pergunta."
  },
  suggestTime: {
    button: "Sugerir tempo",
    result: "Sugestão: {seconds} s",
    apply: "Usar {seconds} s",
    same: "Já está com esse tempo",
    dismiss: "Dispensar"
  },
  errors: {
    quota: "Seus créditos de IA de hoje não cobrem este pedido (restam {remaining}). A cota renova à meia-noite (UTC).",
    quotaUnknown: "Seus créditos de IA de hoje não cobrem este pedido. A cota renova à meia-noite (UTC).",
    tooManyJobs: "Você já tem gerações em andamento. Aguarde uma terminar para começar outra.",
    disabled: "A IA de criação está desligada neste ambiente.",
    draftBlocked: "Um dos rascunhos tem erro. Use \"Adicionar mesmo assim\" para incluí-lo.",
    alreadyApplied: "Estes rascunhos já foram adicionados ao quiz.",
    notReady: "A geração ainda não terminou.",
    conflict: "O quiz foi alterado em outra aba. Recarregamos a versão mais nova; tente de novo.",
    generic: "Não foi possível concluir a ação de IA."
  }
} as const;
