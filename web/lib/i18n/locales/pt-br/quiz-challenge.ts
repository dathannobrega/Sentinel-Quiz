/** Sentinel Arena: desafios no ritmo de cada um (Incremento 6). */
export const quizChallenge = {
  meta: {
    playTitle: "Desafio",
    panelTitle: "Painel do desafio"
  },
  states: {
    scheduled: "Agendado",
    open: "Aberto",
    closed: "Encerrado"
  },
  reasons: {
    completed: "Concluiu",
    time_up: "Tempo esgotado",
    closed: "Prazo encerrado",
    handed_in: "Entregou antes"
  },
  repeat: {
    badge: "Repetição?",
    hint: "Alguém já tinha jogado deste aparelho com outro nome. Pode ser a mesma pessoa tentando de novo."
  },
  sessions: {
    badge: "Desafio",
    panel: "Painel"
  },
  funnel: {
    title: "Funil",
    description: "Quantas pessoas avançaram em cada etapa, do link aberto à tentativa concluída.",
    opened: "Abriram o link",
    joined: "Entraram",
    started: "Começaram",
    finished: "Concluíram",
    value: "{label}: {count}"
  },
  attempts: {
    title: "Tentativas por pessoa",
    none: "Ninguém começou ainda.",
    one: "1 tentativa",
    many: "{count} tentativas",
    peopleOne: "1 pessoa",
    people: "{count} pessoas"
  },
  create: {
    title: "Criar desafio",
    short: "Desafio",
    description: "Gera um link para cada pessoa responder no próprio ritmo, até o prazo. Ninguém precisa estar ao vivo.",
    mustPublishTitle: "Publique antes",
    mustPublish: "O desafio usa a versão publicada do quiz. Publique o quiz para criar um desafio.",
    usesPublished: "O desafio usa a versão publicada (v{version}). Alterações ainda não publicadas ficam de fora.",
    window: {
      legend: "Quando",
      opens: "Abertura",
      now: "Agora",
      later: "Agendar",
      opensAt: "Data e hora de abertura",
      closesAt: "Prazo",
      closesHint: "O desafio fecha sozinho nesse horário (até 90 dias depois da abertura).",
      shortcuts: "Atalhos de prazo",
      shortcut1: "1 dia",
      shortcut3: "3 dias",
      shortcut7: "1 semana"
    },
    attempts: {
      label: "Tentativas por pessoa",
      hint: "Vale a melhor tentativa de cada pessoa no ranking e no relatório.",
      one: "1 tentativa",
      many: "{count} tentativas"
    },
    time: {
      legend: "Tempo",
      per_item: {
        name: "Por pergunta",
        description: "Cada pergunta usa o tempo definido no quiz (com tempo estendido para quem precisar)."
      },
      total: {
        name: "Tempo total",
        description: "Um único relógio para a tentativa inteira."
      },
      none: {
        name: "Sem tempo",
        description: "Cada pessoa responde com calma, até o prazo do desafio."
      },
      minutes: "Minutos para a tentativa",
      minutesHint: "De 1 a 240 minutos."
    },
    feedback: {
      legend: "Correção",
      hint: "Quando cada pessoa vê se acertou, a resposta certa e a explicação.",
      default: "Recomendado",
      each: {
        name: "A cada pergunta",
        description: "Logo depois de responder. Bom para estudar; facilita passar as respostas adiante."
      },
      end: {
        name: "Ao terminar",
        description: "Quando a pessoa conclui a tentativa, com todas as respostas de uma vez."
      },
      after_close: {
        name: "Depois do prazo",
        description: "Só quando o desafio fecha. Ideal com ranking: ninguém vê o gabarito antes dos outros."
      },
      never: {
        name: "Nunca",
        description: "A pessoa vê só a pontuação. Útil para avaliações que você vai reaplicar."
      }
    },
    leaderboard: {
      label: "Mostrar ranking",
      description: "Os participantes veem a própria posição e o top 10.",
      hintTitle: "Dica:",
      hint: "com ranking, a correção fica para depois do prazo e vale exigir login. Assim fica mais difícil alguém entrar com outro nome só para repetir o desafio.",
      requireLogin: "Exigir login"
    },
    shuffle: {
      label: "Embaralhar perguntas e opções",
      description: "Cada tentativa tem uma ordem diferente. Slides de conteúdo ficam no lugar."
    },
    requireLogin: {
      label: "Exigir login",
      description: "Só participa quem entrar com uma conta Sentinel."
    },
    requireLoginAndCreate: "Exigir login e criar",
    submit: "Criar desafio",
    submitting: "Criando...",
    errors: {
      opensRequired: "Informe a data e a hora de abertura.",
      opensPast: "A abertura já passou. Escolha um horário futuro ou abra agora.",
      closesRequired: "Informe o prazo.",
      closesPast: "O prazo precisa ser pelo menos um minuto no futuro.",
      closesBeforeOpens: "O prazo precisa ser depois da abertura.",
      windowTooLong: "O desafio pode ficar aberto por no máximo 90 dias.",
      totalRange: "Use um número inteiro de 1 a 240 minutos.",
      attemptsRange: "Escolha de 1 a 5 tentativas.",
      invalid_window: "Confira as datas: o prazo precisa ser futuro, depois da abertura e em até 90 dias.",
      invalid_total_time: "O tempo total precisa ficar entre 1 e 240 minutos.",
      invalid_attempts: "Escolha de 1 a 5 tentativas.",
      invalid_feedback: "Escolha uma opção de correção.",
      invalid_time_mode: "Escolha uma opção de tempo.",
      no_interactive: "O quiz precisa de pelo menos uma pergunta.",
      quiz_not_published: "Publique o quiz antes de criar um desafio.",
      challenge_closed: "Este desafio já foi encerrado.",
      challenge_not_found: "Desafio não encontrado.",
      slug_exhausted: "Não foi possível gerar o link agora. Tente de novo.",
      offline: "Sem conexão. Verifique a internet e tente de novo.",
      generic: "Não foi possível concluir. Tente de novo."
    }
  },
  panel: {
    back: "Voltar para as sessões",
    window: "De {opens} até {closes}",
    opensIn: "Abre em {time}",
    closesIn: "Fecha em {time}",
    updated: "Atualizado em {time}",
    refreshing: "atualizando…",
    loadError: "Não foi possível carregar o desafio.",
    notFound: "Desafio não encontrado.",
    postpone: "Adiar prazo",
    closeNow: "Fechar agora",
    report: "Ver relatório",
    stats: {
      inProgress: "Respondendo agora",
      attempts: "Tentativas",
      median: "Duração mediana",
      repeat: "Possível repetição"
    },
    leaderboard: {
      title: "Ranking (top 10)",
      empty: "Ninguém concluiu uma tentativa ainda.",
      rank: "#",
      name: "Nome",
      score: "Pontos",
      correct: "Acertos"
    },
    recent: {
      title: "Conclusões recentes",
      empty: "As tentativas concluídas aparecem aqui.",
      attempt: "Tentativa {n}",
      score: "{score} pts · {correct} acertos"
    },
    share: {
      title: "Link do desafio",
      text: "Compartilhe o link ou o QR code. Ele vale até o prazo.",
      qrLabel: "QR code do desafio {title}",
      copy: "Copiar link",
      copied: "Link copiado",
      qr: "QR para imprimir"
    },
    settings: {
      title: "Configuração",
      attempts: "Tentativas por pessoa",
      time: "Tempo",
      totalMinutes: "{minutes} min no total",
      feedback: "Correção",
      leaderboard: "Ranking",
      shuffle: "Embaralhar",
      access: "Acesso",
      yes: "Sim",
      no: "Não"
    },
    postponeDialog: {
      title: "Adiar prazo",
      description: "Escolha o novo prazo. Tentativas com tempo total em andamento respeitam o novo fim.",
      save: "Salvar prazo",
      plus1: "+1 dia",
      plus3: "+3 dias",
      plus7: "+1 semana"
    },
    closeConfirm: {
      title: "Fechar o desafio agora?",
      message: "Ninguém mais entra nem responde. Tentativas em andamento são encerradas como estão e o ranking fica final.",
      confirm: "Fechar agora"
    }
  },
  report: {
    title: "Desafio",
    description: "Conta uma tentativa por pessoa: a melhor concluída. Quem não concluiu nenhuma fica fora do relatório; o funil mostra essa diferença.",
    attempts: "Tentativas no total",
    median: "Duração mediana",
    repeat: "Possível repetição",
    repeatHint: "Tentativas marcadas com “Repetição?” vieram de um aparelho que outra pessoa já tinha usado. Vale conferir antes de premiar.",
    open: "O desafio ainda está aberto: os números mudam até o prazo."
  },
  play: {
    brand: "Sentinel Arena · Desafio",
    loading: "Carregando o desafio...",
    deadline: "Prazo: {date}",
    errors: {
      challenge_not_found: "Não encontramos este desafio. Confira o link.",
      challenge_not_open: "Este desafio ainda não abriu.",
      challenge_closed: "Este desafio já foi encerrado.",
      login_required: "Este desafio exige login. Entre com sua conta para participar.",
      name_taken: "Esse nome já está em uso neste desafio. Escolha outro.",
      name_rejected: "Esse nome não pode ser usado. Escolha outro.",
      consent_required: "Marque o consentimento para entrar.",
      room_full: "O desafio atingiu o limite de participantes.",
      rate_limited: "Muitas tentativas seguidas. Espere um pouco e tente de novo.",
      offline: "Sem conexão. Verifique a internet e tente de novo.",
      generic: "Algo deu errado. Tente de novo."
    },
    attemptErrors: {
      attempts_exhausted: "Você já usou todas as tentativas deste desafio.",
      challenge_not_open: "Este desafio ainda não abriu.",
      challenge_closed: "Este desafio já foi encerrado.",
      attempt_not_found: "Você ainda não começou este desafio.",
      challenge_empty: "Este desafio ficou sem perguntas.",
      banned: "Você foi removido deste desafio.",
      token: "Sua sessão expirou. Entre de novo com o código de retorno.",
      offline: "Sem conexão. Verifique a internet e tente de novo.",
      generic: "Algo deu errado. Tente de novo."
    },
    join: {
      subtitle: "Seu nome aparece no ranking e no relatório de quem criou o desafio.",
      submit: "Entrar no desafio"
    },
    scheduled: {
      title: "Ainda não abriu",
      opensAt: "Abre em {date}",
      countdown: "Abre em {time}",
      text: "Deixe esta página aberta: ela atualiza sozinha na hora da abertura."
    },
    open: {
      closesIn: "Fecha em {time}",
      continueTitle: "Você já está neste desafio",
      continueAs: "Continuar como {name}",
      continueText: "Para continuar neste aparelho, confirme com o código de retorno que você recebeu ao entrar.",
      continue: "Continuar",
      notYou: "Não é você? Entrar com outro nome"
    },
    closed: {
      title: "Desafio encerrado",
      text: "O prazo terminou em {date}.",
      resultsTitle: "Participou?",
      resultsText: "Use o nome e o código de retorno que você recebeu ao entrar para ver sua pontuação e a correção.",
      resultsCta: "Ver meus resultados"
    },
    rules: {
      kicker: "Antes de começar",
      title: "Como funciona",
      questionsOne: "1 pergunta",
      questions: "{count} perguntas",
      time: {
        per_item: "Cada pergunta tem o próprio tempo",
        total: "{minutes} minutos para a tentativa inteira",
        none: "Sem cronômetro: responda com calma até o prazo"
      },
      attemptsOne: "1 tentativa",
      attempts: "{count} tentativas",
      feedback: {
        each: "Você vê a correção logo depois de cada resposta",
        end: "Você vê a correção ao terminar",
        after_close: "A correção sai depois do prazo ({date})",
        never: "Este desafio mostra só a pontuação, sem correção"
      },
      leaderboard: "Tem ranking",
      noLeaderboard: "Sem ranking",
      bestCounts: "Vale a sua melhor tentativa.",
      start: "Começar",
      starting: "Preparando...",
      noAttempt: "Você não fez nenhuma tentativa neste desafio."
    },
    game: {
      progress: "Item {current} de {total}",
      progressLabel: "Progresso no desafio",
      totalLeftSr: "Tempo total restante: {time}",
      timeWarn: "Faltam {seconds} segundos",
      handIn: "Entregar",
      handInTitle: "Entregar agora?",
      handInText: "As perguntas que faltam ficam sem resposta e a tentativa termina. Não dá para desfazer.",
      handInConfirm: "Entregar",
      handInCancel: "Continuar respondendo",
      contentContinue: "Continuar",
      timeUp: "Tempo esgotado",
      timeUpWaiting: "Indo para a próxima...",
      timeUpStuck: "Não conseguimos atualizar. Toque para tentar de novo.",
      sending: "Enviando...",
      sendFailed: "Sua resposta não foi enviada. Ela fica guardada: tente de novo.",
      resend: "Enviar de novo",
      invalid: "Não entendemos essa resposta. Tente de novo.",
      stale: "Sua tentativa avançou em outra aba. Mostrando onde ela está.",
      closed: "Esta tentativa já terminou.",
      next: "Próxima",
      loadingNext: "Carregando a próxima...",
      seeResult: "Ver resultado"
    },
    announce: {
      item: "Item {current} de {total}: {prompt}",
      feedback: "Correção da resposta",
      finished: "Tentativa concluída"
    },
    summary: {
      title: "Tentativa concluída",
      reasons: {
        completed: "Você respondeu tudo.",
        time_up: "O tempo acabou.",
        closed: "O prazo do desafio terminou.",
        handed_in: "Você entregou antes do fim."
      },
      score: "{score} pontos",
      correctLabel: "Acertos",
      correct: "{correct} de {total}",
      answeredLabel: "Respondidas",
      answered: "{answered} de {total}",
      durationLabel: "Duração",
      rankLabel: "Posição",
      rank: "{rank} de {total}",
      attemptsUsedLabel: "Tentativas usadas",
      attemptOf: "{n} de {total}",
      best: "Sua melhor pontuação: {score}",
      tryAgain: "Tentar de novo",
      attemptsLeftOne: "Resta 1 tentativa.",
      attemptsLeft: "Restam {count} tentativas.",
      noAttemptsLeft: "Você usou todas as tentativas.",
      corrections: {
        title: "Correção",
        hiddenAfterClose: "A correção sai depois do prazo, em {date}. Volte por este mesmo link.",
        hiddenNever: "Este desafio não mostra a correção.",
        item: "Pergunta {n}",
        yourAnswer: "Sua resposta",
        correctAnswer: "Resposta certa",
        noAnswer: "Sem resposta",
        points: "+{points} pts",
        status: {
          correct: "Certa",
          incorrect: "Errada",
          partial: "Parcial",
          noAnswer: "Sem resposta",
          notScored: "Sem pontuação"
        }
      }
    },
    leaderboard: {
      title: "Ranking provisório",
      final: "Ranking final",
      provisional: "Muda até o prazo",
      yourPosition: "Sua posição: {rank} de {total}",
      notRanked: "Você entra no ranking ao concluir uma tentativa.",
      you: "você",
      points: "pontos",
      error: "Não foi possível carregar o ranking."
    }
  }
} as const;
