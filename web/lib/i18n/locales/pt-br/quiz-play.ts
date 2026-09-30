export const quizPlay = {
  meta: {
    entryTitle: "Entrar no quiz ao vivo",
    roomTitle: "Quiz ao vivo"
  },
  brand: "Sentinel Arena",
  entry: {
    title: "Entre no quiz",
    subtitle: "Digite o PIN de 6 dígitos que aparece no telão.",
    label: "PIN da sala",
    submit: "Entrar",
    checking: "Procurando a sala...",
    pasteHint: "Você também pode colar o PIN ou o link.",
    invalid: "O PIN tem 6 dígitos e não começa com zero."
  },
  room: {
    loading: "Carregando a sala...",
    pin: "PIN {code}",
    participants: "{count} na sala",
    changeCode: "Usar outro PIN",
    retry: "Tentar de novo"
  },
  join: {
    title: "Como você quer aparecer?",
    subtitle: "Seu nome aparece no telão e no placar.",
    nameLabel: "Seu nome",
    namePlaceholder: "Ex.: Firewall Veloz",
    nameHint: "De 2 a 24 caracteres. Evite dados pessoais.",
    nameTooShort: "Use pelo menos 2 caracteres.",
    nameTooLong: "Use no máximo 24 caracteres.",
    suggest: "Sugerir nome",
    suggesting: "Sugerindo...",
    suggestFailed: "Não deu para sugerir agora. Tente de novo.",
    consentLabel: "Concordo com o uso do meu nome e das minhas respostas nesta sessão.",
    consentText:
      "Usamos seu nome e suas respostas só para este quiz e o relatório do apresentador (LGPD, termo {version}). Não pedimos e-mail nem contato.",
    consentRequired: "Marque o consentimento para entrar.",
    submit: "Entrar na sala",
    submitting: "Entrando...",
    signIn: "Entrar com minha conta",
    haveReturnCode: "Já entrei antes e tenho um código de retorno",
    loginOnlyTitle: "Esta sala exige login",
    loginOnlyText: "O apresentador pediu que todos entrem com uma conta Sentinel.",
    closedTitle: "Entradas fechadas",
    closedText: "O apresentador não está aceitando novas entradas agora. Se você já estava na sala, use seu código de retorno."
  },
  rejoin: {
    title: "Voltar para a sala",
    subtitle: "Use o mesmo nome e o código de retorno que você recebeu ao entrar.",
    codeLabel: "Código de retorno",
    codePlaceholder: "Ex.: K7Q-2MX",
    codeRequired: "Informe o código de retorno.",
    submit: "Voltar para a sala",
    submitting: "Voltando...",
    back: "Entrar como novo participante"
  },
  returnCode: {
    title: "Você está dentro!",
    subtitle: "Guarde este código. Com ele você volta para a sala se fechar a aba ou trocar de aparelho.",
    label: "Seu código de retorno",
    copy: "Copiar",
    copied: "Copiado!",
    continue: "Anotei, continuar",
    showAgain: "Ver meu código de retorno",
    hide: "Ocultar código"
  },
  errors: {
    room_not_found: "Não encontramos uma sala com esse PIN. Confira os números no telão.",
    room_locked: "A sala está trancada pelo apresentador. Peça para liberar a entrada.",
    room_full: "A sala está lotada. Fale com o apresentador.",
    session_finished: "Esta sessão já terminou.",
    login_required: "Esta sala exige login. Entre com sua conta para participar.",
    name_taken: "Já tem alguém com esse nome. Escolha outro ou use seu código de retorno.",
    name_rejected: "Esse nome não é permitido. Escolha outro ou use a sugestão.",
    consent_required: "Marque o consentimento para entrar.",
    invalid_return_code: "O código de retorno não confere com esse nome. Confira e tente de novo.",
    rate_limited: "Muita gente entrando ao mesmo tempo. Tente de novo em alguns segundos.",
    offline: "Sem conexão com a internet. Confira sua rede e tente de novo.",
    generic: "Algo deu errado. Tente de novo.",
    tokenLost: "Sua entrada expirou. Volte para a sala com seu nome e código de retorno."
  },
  connection: {
    connecting: "Conectando...",
    reconnecting: "Conexão instável. Reconectando...",
    offline: "Você está offline. Vamos reconectar assim que a rede voltar.",
    retry: "Reconectar",
    closed: {
      auth: "Sua entrada não é mais válida.",
      token_expired: "Sua entrada expirou.",
      kicked: "O apresentador removeu você desta sessão.",
      banned: "O apresentador bloqueou sua entrada nesta sessão.",
      room_full: "A sala está lotada.",
      session_ended: "A sessão foi encerrada.",
      protocol: "Seu app está desatualizado. Recarregue a página.",
      policy: "Conexão recusada pelo servidor.",
      generic: "A conexão foi encerrada."
    }
  },
  lobby: {
    title: "Você está dentro!",
    findYourName: "Procure seu nome no telão.",
    waiting: "Aguardando o apresentador...",
    count: "{count} pessoas na sala",
    notYou: "Não é você? Sair"
  },
  question: {
    counter: "Pergunta {current} de {total}",
    getReady: "Prepare-se",
    opensIn: "Respostas em {seconds}",
    timeLeft: "{seconds} segundos restantes",
    readingSr: "Leia a pergunta. As respostas abrem em {seconds} segundos.",
    points: "{multiplier}x pontos",
    noPoints: "Sem pontos",
    poll: "Enquete",
    selectN: "Selecione {count}",
    selectAny: "Selecione uma ou mais",
    selectedCount: "{count} selecionadas",
    send: "Enviar",
    typeLabel: "Sua resposta",
    typePlaceholder: "Digite sua resposta",
    choose: "Escolha uma alternativa",
    option: "{letter}: {text}"
  },
  submitted: {
    title: "Resposta enviada!",
    sending: "Enviando...",
    waiting: "Aguardando os outros...",
    yourChoice: "Sua resposta",
    progress: "{answered} de {total} responderam",
    rejected: {
      late: "O tempo acabou antes da sua resposta chegar.",
      closed: "A pergunta já foi fechada.",
      invalid: "Não conseguimos registrar essa resposta. Tente de novo."
    }
  },
  locked: {
    title: "Respostas travadas",
    subtitle: "Vem aí o resultado...",
    missed: "Você não respondeu esta."
  },
  reveal: {
    correct: "Correta!",
    incorrect: "Não foi dessa vez",
    partial: "Parcialmente correta",
    noAnswer: "Tempo esgotado",
    pollDone: "Voto registrado",
    recorded: "Resposta registrada",
    correctWas: "A correta era {answer}",
    acceptedWere: "Respostas aceitas: {answer}",
    points: "+{points}",
    pointsLabel: "pontos nesta pergunta",
    streak: "Sequência de {count}",
    rank: "{rank}º lugar",
    rankUp: "subiu {n}",
    rankDown: "caiu {n}",
    total: "{score} pontos no total",
    encouragement: "Bora! A próxima é sua.",
    explanation: "Por quê?"
  },
  leaderboard: {
    title: "Placar",
    yourPosition: "Sua posição",
    behind: "Faltam {points} pontos para o {rank}º",
    leading: "Você está na liderança!",
    score: "{score} pontos",
    notRanked: "Responda às perguntas para entrar no placar."
  },
  content: {
    title: "Acompanhe no telão"
  },
  final: {
    title: "Fim de jogo!",
    place: "Você terminou em {rank}º de {total}",
    score: "{score} pontos",
    thanks: "Obrigado por participar!",
    podiumWait: "Olhe o telão: o pódio está saindo!",
    viewResults: "Ver minhas respostas",
    hideResults: "Ocultar minhas respostas"
  },
  results: {
    title: "Suas respostas",
    loading: "Carregando suas respostas...",
    error: "Não foi possível carregar suas respostas.",
    summary: "{correct} acertos em {total} perguntas pontuadas",
    item: "Pergunta {position}",
    yourAnswer: "Sua resposta",
    correctAnswer: "Resposta correta",
    noAnswer: "Sem resposta",
    correct: "Correta",
    incorrect: "Incorreta",
    partial: "Parcial",
    notScored: "Não pontuada",
    points: "{points} pts"
  },
  kicked: {
    title: "Você saiu da sala",
    back: "Voltar ao início"
  },
  leave: {
    confirmTitle: "Sair desta sala?",
    confirmText: "Você pode voltar depois com o mesmo nome e o código de retorno.",
    confirm: "Sair",
    cancel: "Continuar na sala"
  },
  announce: {
    lobby: "Você está na sala. Aguardando o apresentador.",
    question: "Pergunta {current} de {total}: {prompt}",
    open: "Respostas abertas.",
    locked: "Respostas travadas.",
    reveal: "Resultado da pergunta.",
    leaderboard: "Placar.",
    podium: "Pódio final.",
    finished: "Sessão encerrada.",
    submitted: "Resposta enviada."
  }
} as const;
