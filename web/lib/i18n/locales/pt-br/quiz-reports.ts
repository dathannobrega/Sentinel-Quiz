export const quizReports = {
  metadata: {
    title: "Resultados da sessão"
  },
  header: {
    context: "Resultados · PIN {code}",
    back: "Sessões do quiz",
    meta: "Versão {version} · {date}",
    generated: "Relatório gerado em {date}",
    exportCsv: "Exportar CSV",
    exporting: "Exportando…",
    exportError: "Não foi possível exportar o CSV.",
    print: "Imprimir",
    sections: "Seções do relatório",
    live: "A sessão ainda está em andamento; os números podem mudar.",
    refresh: "Atualizar",
    rehearsalHint: "Sessão de ensaio. Os bots não entram neste relatório nem no CSV."
  },
  kpis: {
    title: "Resumo",
    participants: "Participantes",
    completion: "Conclusão",
    completionMeta: "responderam 80% ou mais",
    engagement: "Engajamento {value}",
    avgScore: "Acerto médio",
    median: "Mediana {value}",
    avgTime: "Tempo médio de resposta",
    kr20: "Confiabilidade (KR-20)",
    kr20Help: "Sobre o KR-20",
    kr20Explanation:
      "O KR-20 mede o quanto as perguntas concordam entre si ao separar quem sabe mais de quem sabe menos. Vai de 0 a 1: a partir de 0,70 é aceitável para um quiz formativo. Precisa de pelo menos 5 perguntas pontuáveis e 15 participantes.",
    kr20Acceptable: "aceitável",
    kr20Low: "baixa",
    insufficient: "amostra insuficiente"
  },
  highlights: {
    title: "Destaques",
    flagged: "{count} perguntas com sinais de atenção",
    none: "Nenhuma pergunta com sinal de atenção.",
    hardest: "Mais difícil: pergunta {position} ({value} de acerto)"
  },
  domains: {
    title: "Acerto por domínio",
    description: "Faixas da turma nesta sessão. Não é a prontidão individual de cada aluno.",
    meta: "{items} perguntas · {answers} respostas",
    none: "Nenhuma pergunta desta sessão tem domínio associado.",
    noCertification: "Sem certificação",
    bands: {
      ready: "Pronta",
      approaching: "Quase lá",
      not_ready: "Precisa reforçar",
      insufficient_data: "Amostra insuficiente"
    }
  },
  items: {
    title: "Perguntas",
    description: "p = proporção de acerto; D = discriminação (27% melhores menos 27% piores). Abra uma linha para ver as alternativas.",
    columns: {
      position: "Nº",
      prompt: "Pergunta",
      p: "p",
      d: "D",
      time: "Tempo mediano",
      flags: "Sinais"
    },
    pLabel: "Dificuldade p",
    dLabel: "Discriminação D",
    notScored: "Sem pontos",
    answered: "{count} responderam",
    expand: "Ver detalhes da pergunta {position}",
    collapse: "Ocultar detalhes da pergunta {position}",
    distractors: "Distribuição por alternativa",
    distractorsHint: "Barra = todos os participantes. ▼ acima da barra = 27% melhores; ▲ abaixo = 27% piores.",
    correct: "Correta",
    upper: "27% melhores",
    lower: "27% piores",
    optionSummary: "{letter}: {pct} ({count})",
    dominant: "A alternativa {letter} atraiu mais que a correta: vale revisar o enunciado ou o gabarito.",
    topAnswers: "Respostas mais digitadas",
    accepted: "Aceita",
    notAccepted: "Não aceita",
    noOptions: "Sem alternativas para mostrar.",
    difficulty: {
      hard: "difícil",
      ideal: "ideal",
      easy: "fácil",
      too_easy: "fácil demais"
    },
    discrimination: {
      excellent: "ótima",
      good: "boa",
      review: "revisar",
      negative: "suspeita"
    },
    flags: {
      too_easy: {
        label: "Fácil demais",
        explanation: "Mais de 90% acertaram: a pergunta quase não diferencia quem sabe de quem não sabe."
      },
      too_hard: {
        label: "Difícil demais",
        explanation: "Menos de 20% acertaram: pode ser conteúdo não visto, enunciado confuso ou gabarito errado."
      },
      negative_discrimination: {
        label: "Discriminação negativa",
        explanation: "Quem foi pior no quiz acertou mais esta pergunta do que quem foi melhor. Confira o gabarito."
      },
      low_discrimination: {
        label: "Discriminação baixa",
        explanation: "A pergunta separa pouco os grupos (D abaixo de 0,20). Considere reescrever alternativas."
      },
      distractor_dominant: {
        label: "Distrator dominante",
        explanation: "Uma alternativa errada foi mais escolhida que a correta: sinal de pegadinha ou equívoco comum."
      }
    }
  },
  participants: {
    title: "Participantes",
    description: "Ranking final. Clique no cabeçalho para ordenar.",
    columns: {
      rank: "Posição",
      display_name: "Nome",
      score: "Pontos",
      correct: "Acertos",
      score_pct: "Acerto",
      avg_ms: "Tempo médio"
    },
    guest: "Convidado",
    sortBy: "Ordenar por {column}",
    correctOf: "{correct} de {answered}",
    none: "Ninguém participou desta sessão."
  },
  empty: {
    title: "Esta sessão não recebeu respostas",
    message: "Quando a turma responder pelo menos uma pergunta, os números aparecem aqui."
  },
  errors: {
    load: "Não foi possível carregar o relatório.",
    notFound: "Sessão não encontrada ou sem relatório."
  },
  retention: {
    title: "Retrato agregado",
    text: "Dados brutos expurgados pela política de retenção; este é o retrato agregado.",
    purgedAt: "Expurgo em {date}."
  }
} as const;
