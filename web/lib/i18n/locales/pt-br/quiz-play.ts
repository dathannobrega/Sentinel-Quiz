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
    transportSse: "Conexão alternativa",
    transportSseHint: "Sua rede bloqueou a conexão em tempo real. Seguimos por uma conexão alternativa; tudo continua funcionando.",
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
    option: "{letter}: {text}",
    extendedTime: "Tempo estendido: {multiplier}×",
    untimed: "Sem limite de tempo",
    untimedHint: "Você tem o tempo que precisar para esta pergunta."
  },
  paused: {
    title: "O apresentador pausou",
    subtitle: "O tempo está congelado. Você continua de onde parou quando a pergunta voltar.",
    timeLeft: "{seconds} segundos restantes quando retomar"
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
      invalid: "Não conseguimos registrar essa resposta. Tente de novo.",
      paused: "A pergunta estava pausada e sua resposta não foi registrada. Responda de novo quando o apresentador retomar."
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
    submitted: "Resposta enviada.",
    paused: "O apresentador pausou a pergunta.",
    resumed: "Pergunta retomada. Respostas abertas."
  },
  menu: {
    label: "Mais opções",
    report: "Denunciar",
    myData: "Meus dados",
    reportQuestion: "Denunciar esta pergunta"
  },
  report: {
    title: "Denunciar",
    subtitle: "A equipe de moderação analisa cada denúncia. Quem apresenta não vê quem denunciou.",
    targetLabel: "O que você quer denunciar?",
    targetItem: "Esta pergunta (item {position})",
    targetSession: "A sessão toda",
    reasonLabel: "Motivo",
    reasons: {
      offensive: "Conteúdo ofensivo",
      spam: "Spam ou propaganda",
      cheating: "Trapaça ou fraude",
      copyright: "Direitos autorais",
      privacy: "Exposição de dados pessoais",
      other: "Outro motivo"
    },
    noteLabel: "Detalhes (opcional)",
    noteHint: "Até 500 caracteres. Não escreva dados pessoais.",
    noteCount: "{count}/{max}",
    reasonRequired: "Escolha um motivo.",
    submit: "Enviar denúncia",
    submitting: "Enviando…",
    cancel: "Cancelar",
    success: "Denúncia enviada. Obrigado por ajudar a manter a sala segura.",
    errors: {
      too_many_reports: "Você já enviou várias denúncias; a equipe está analisando. Tente mais tarde.",
      token: "Sua participação expirou. Entre de novo para denunciar.",
      invalid_item: "Este item não existe mais. Denuncie a sessão.",
      offline: "Sem conexão. Verifique a internet e tente de novo.",
      generic: "Não foi possível enviar a denúncia. Tente de novo."
    }
  },
  myData: {
    title: "Meus dados",
    subtitle: "O que esta sala guarda sobre você (LGPD, art. 18).",
    link: "Meus dados e privacidade",
    loading: "Carregando seus dados…",
    error: "Não foi possível carregar seus dados.",
    retry: "Tentar de novo",
    close: "Fechar",
    profile: "Participação",
    name: "Nome",
    joined: "Entrou em",
    lastSeen: "Visto por último",
    consent: "Termo aceito",
    account: "Conta vinculada",
    accountYes: "Sim",
    accountNo: "Não (convidado)",
    score: "Pontuação final",
    rank: "Posição final",
    session: "Sessão",
    sessionStatus: {
      lobby: "Aguardando início",
      live: "Em andamento",
      finished: "Encerrada"
    },
    none: "—",
    answersTitle: "Suas respostas ({count})",
    noAnswers: "Nenhuma resposta registrada.",
    answerItem: "Item {position}",
    answerCorrect: "Correta",
    answerIncorrect: "Incorreta",
    answerNotScored: "Sem pontuação",
    answerPoints: "{points} pts",
    retention: "As respostas ficam como estatística anônima da sessão; os nomes são anonimizados pela política de retenção.",
    eraseTitle: "Excluir meus dados",
    eraseText: "Seu nome é substituído por “Participante removido”, você sai do placar e dos relatórios nominais, e esta participação não poderá mais ser vinculada a uma conta. As respostas continuam só como estatística anônima. Não dá para desfazer.",
    eraseAction: "Excluir meus dados",
    eraseConfirm: "Excluir definitivamente",
    eraseCancel: "Manter meus dados",
    erasing: "Excluindo…",
    eraseError: "Não foi possível excluir seus dados. Tente de novo.",
    noParticipation: "Você ainda não entrou nesta sala. Depois de entrar, abra “Meus dados” no menu da tela para ver ou excluir o que guardamos.",
    rightsText: "Guardamos seu apelido, suas respostas e horários só para esta sessão. Você pode ver e excluir esses dados a qualquer momento."
  },
  access: {
    title: "Confirme que é você",
    subtitle: "Sua sessão expirou neste aparelho. Use o nome e o código de retorno que apareceram quando você entrou.",
    nameLabel: "Seu nome na sala",
    codeLabel: "Código de retorno",
    codePlaceholder: "Ex.: K7Q2MX",
    submit: "Acessar",
    submitting: "Verificando…",
    required: "Preencha o nome e o código de retorno.",
    noSession: "Não encontramos a sessão neste aparelho. Abra o link da sala para acessar seus dados.",
    errors: {
      invalid_return_code: "Nome ou código de retorno não conferem.",
      too_many_attempts: "Muitas tentativas. Aguarde 15 minutos e tente de novo.",
      banned: "Você foi removido desta sala.",
      offline: "Sem conexão. Verifique a internet e tente de novo.",
      generic: "Não foi possível acessar agora. Tente de novo."
    }
  },
  claim: {
    title: "Salvar meu resultado na minha conta",
    text: "Vincule esta participação à sua conta até {date}. Respostas de perguntas do Banco entram no seu progresso de estudo.",
    textNoDate: "Vincule esta participação à sua conta. Respostas de perguntas do Banco entram no seu progresso de estudo.",
    cta: "Salvar meu resultado na minha conta",
    signedInAs: "Conectado como {email}",
    login: "Entrar para salvar",
    register: "Criar conta",
    busy: "Salvando…",
    successTitle: "Resultado salvo na sua conta",
    successBank: "{count} respostas do Banco entraram no seu progresso.",
    successNoBank: "Nenhuma pergunta desta sessão veio do Banco, então o progresso de estudo não mudou.",
    errors: {
      claim_session_active: "A sessão ainda está em andamento. Salve quando ela terminar.",
      claim_already_linked: "Esta participação já está vinculada a uma conta.",
      claim_expired: "O prazo para salvar terminou (7 dias após o fim da sessão).",
      claim_not_available: "Esta sessão não permite salvar resultados em contas.",
      claim_already_in_session: "Sua conta já tem uma participação nesta sessão.",
      login_required: "Entre na sua conta para salvar o resultado.",
      token: "Sua participação expirou neste aparelho. Confirme com o código de retorno.",
      offline: "Sem conexão. Verifique a internet e tente de novo.",
      generic: "Não foi possível salvar agora. Tente de novo."
    }
  },
  removed: {
    title: "Conteúdo removido pela moderação",
    text: "Este item foi retirado e não vale pontos. Aguarde o próximo."
  },
  afterSession: {
    title: "Já participou desta sessão?",
    text: "Veja seus resultados, seus dados ou salve o resultado na sua conta com o nome e o código de retorno.",
    cta: "Ver meus resultados e dados",
    back: "Voltar",
    resultsTab: "Resultados",
    dataTab: "Meus dados"
  },
  erased: {
    title: "Seus dados foram excluídos",
    text: "Você saiu do placar e dos relatórios. As credenciais deste aparelho foram apagadas.",
    back: "Entrar em outra sala"
  },
  toast: {
    dismiss: "Fechar aviso"
  }
} as const;
