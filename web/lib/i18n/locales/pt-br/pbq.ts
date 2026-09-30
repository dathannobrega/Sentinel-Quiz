export const pbq = {
  badge: "PBQ",
  formatLabel: "Questão baseada em desempenho (PBQ)",
  subtitle: "Questão baseada em desempenho: resolva cada tarefa e confirme ao final.",
  scenario: "Cenário",
  exhibits: "Anexos",
  exhibitFallbackTitle: "Anexo {number}",
  taskHeading: "Tarefa {current} de {total}",
  taskWeight: "Peso {weight}",
  tasksComplete: "Tarefas completas: {complete} de {total}",
  keyboardHelp:
    "Use Tab para percorrer as tarefas. Toda ação de arrastar tem alternativa por botões (Subir/Descer) ou listas de seleção.",
  ordering: {
    listLabel: "Itens na ordem atual",
    moveUp: "Subir “{item}” (mover para cima)",
    moveDown: "Descer “{item}” (mover para baixo)",
    moveUpShort: "Subir",
    moveDownShort: "Descer",
    moved: "“{item}” movido para a posição {position} de {total}.",
    dragHint: "Arraste os itens ou use os botões Subir e Descer.",
    correctPosition: "Posição correta",
    expectedPosition: "Posição correta: {position}",
    correctOrder: "Ordem correta"
  },
  categorization: {
    pool: "Itens sem categoria",
    poolEmpty: "Todos os itens foram classificados.",
    bucketEmpty: "Solte itens aqui.",
    selectLabel: "Categoria de “{item}”",
    unassigned: "Sem categoria",
    assigned: "“{item}” classificado em “{bucket}”.",
    unassignedAnnounce: "“{item}” voltou para os itens sem categoria.",
    dragHint: "Arraste cada item para uma categoria ou escolha a categoria na lista do próprio item.",
    bucketCount: "{count} itens",
    progress: "{done} de {total} itens classificados",
    expected: "Correto: {bucket}"
  },
  matching: {
    selectLabel: "Par de “{item}”",
    placeholder: "Selecione...",
    paired: "“{left}” associado a “{right}”.",
    cleared: "Associação de “{left}” removida.",
    reused: "“{right}” foi removido de “{left}”: cada opção só pode ser usada uma vez.",
    noReuseHint: "Cada opção da direita pode ser usada no máximo uma vez.",
    reuseHint: "Uma mesma opção da direita pode ser usada mais de uma vez.",
    inUse: "{choice} (em uso)",
    progress: "{done} de {total} pares definidos",
    expected: "Correto: {right}"
  },
  tableForm: {
    cellLabel: "{row} — {column}",
    placeholder: "Selecione...",
    numberPlaceholder: "Número",
    expected: "Gabarito: {value}",
    rowHeader: "Item"
  },
  selectInExhibit: {
    legendMultiple: "Selecione todas as linhas que se aplicam em “{title}”",
    legendSingle: "Selecione uma linha em “{title}”",
    exhibitMissing: "Anexo não encontrado.",
    shouldSelect: "Deveria ser selecionada",
    shouldNotSelect: "Não deveria ser selecionada",
    correctlySelected: "Selecionada corretamente"
  },
  marks: {
    correct: "Correto",
    wrong: "Incorreto"
  },
  feedback: {
    title: "Resultado da PBQ",
    score: "Pontuação: {percent}%",
    points: "{earned} de {possible} pontos",
    fullCredit: "Todas as tarefas corretas",
    partialCredit: "Crédito parcial",
    noCredit: "Nenhuma tarefa correta",
    taskResult: "Tarefa {number}: {percent}%",
    taskCorrect: "Tarefa correta",
    taskPartial: "Tarefa parcialmente correta",
    taskWrong: "Tarefa incorreta",
    showSolution: "Mostrar gabarito",
    hideSolution: "Ocultar gabarito",
    explanation: "Explicação",
    announce: "Resposta registrada: {percent}% ({earned} de {possible} pontos)."
  },
  review: {
    title: "Sua resposta vs. gabarito",
    noResponse: "Sem resposta registrada para esta PBQ."
  }
} as const;
