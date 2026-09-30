# Sentinel Arena: contrato do Incremento 5 (tipos ordenar, numérica e nuvem de palavras)

Complementa os contratos dos Incrementos [1](./CONTRATO-INCREMENTO-1.md) a [4](./CONTRATO-INCREMENTO-4.md). A
fonte da verdade é o backend:
- `backend/app/services/live_items.py`: registro dos tipos;
- `backend/app/live/{protocol,runtime}.py`: protocolo e sala;
- `backend/app/services/live_{quiz,results}.py`: autoria, Banco e relatórios;
- testes em `backend/tests/test_live_ga_types.py`.

## 1. Escopo (início do MVP-1/GA)

| Entra | Fica para depois |
|---|---|
| T05 `ordering`: ordenar 3 a 6 itens, com pontuação parcial (Kendall) ou exata | Self-paced (E1.10): próximo incremento |
| T06 `numeric`: número numa faixa, com tolerância e crédito parcial | Mais 3 temas, IA a partir de PDF, colaboração, controle remoto |
| T08 `word_cloud`: 1 a 3 palavras por pessoa, filtro de termos e ocultação pelo host | Nuvem com agrupamento semântico (sinônimos) |
| PBQs do Banco com tarefa de ordenação viram itens `ordering` | Outras tarefas de PBQ (categorizar, associar, tabela) |

## 2. Autoria (`POST/PATCH /api/live/quizzes/{id}/items`)

Campos novos no corpo (escrita parcial, como os demais):

| Tipo | Campo | Regra |
|---|---|---|
| `ordering` | `options: [{text}]` | 3 a 6 itens. **A ordem do autor é a ordem correta**. `correct` é ignorado |
| `ordering` | `order_method` | `kendall` (padrão: troca adjacente ainda pontua bem) ou `exact` |
| `numeric` | `min`, `max`, `step` | Número JSON ou texto pt-BR/en (`"1.234,5"`). `min < max`. `step` > 0 ou `null` (livre). No máximo 100.000 passos na faixa |
| `numeric` | `unit` | Até 12 caracteres (ex.: `"bits"`, `"%"`) |
| `numeric` | `value`, `tolerance`, `partial` | Valor correto dentro da faixa. Tolerância ≥ 0. `partial` (padrão `true`): crédito linear até 3× a tolerância. Com tolerância 0, só o valor exato pontua |
| `word_cloud` | `max_words` | 1 a 3 (padrão 1). Nunca pontua (`points_multiplier` 0) |

O item serializado (`quiz.items[]` e `presenter.item` do host) ganha:
- `ordering`: `order_method`;
- `numeric`: `numeric: {min, max, step, unit, value, tolerance, partial}`;
- `word_cloud`: `max_words`.

Nos outros tipos essas chaves não aparecem.

Mudar o tipo de um item:
- `ordering` e os tipos de alternativas (exceto V/F) mantêm a lista de textos entre si;
- o que não pontua (`poll`, `word_cloud`, `content`, `leaderboard`) vai para `points_multiplier` 0.

Problemas na publicação (`quiz_invalid` / avisos) usam os códigos existentes. Novos `field`/`code`:
- `options/too_few` (ordering < 3), `options/empty_option`, `options/duplicate_option`, `options/long` (aviso);
- `range/invalid_range`, `value/required`, `value/out_of_range`, `step/invalid`, `step/too_fine`.

Tempo padrão: `ordering` 45 s, `numeric` 30 s, `word_cloud` 45 s.

## 3. Pergunta pública (`question.intro` / `room.snapshot.question`)

- `ordering`: `options[]` chegam **embaralhados**, com a mesma ordem para todos da sessão e nunca na ordem correta.
  Os `id` são opacos, como nas alternativas. `index` é a posição inicial na tela.
- `numeric`: `numeric: {min, max, step, unit}` (`null` nos outros tipos). O valor correto nunca vem.
- `word_cloud`: `max_words` (`null` nos outros tipos).

## 4. Resposta (`answer.submit`)

| Tipo | Dados | Recusa (`answer.ack` `invalid`) |
|---|---|---|
| `ordering` | `choice: [id, …]`, com todos os ids na ordem escolhida | Faltando, repetido ou id desconhecido |
| `numeric` | `number: 12.5` (JSON). O celular converte o que a pessoa digitou no idioma dela. `text` com o número em texto também é aceito, lido primeiro como pt-BR (`"1.005"` = 1005) | Fora da faixa, não numérico, NaN/∞ |
| `word_cloud` | `words: ["Zero Trust", "MFA"]` (≤ 3 no frame, cada uma ≤ 25 caracteres) | Mais que `max_words`, vazia |

Palavras repetidas pela mesma pessoa (sem diferenciar maiúsculas e acentos) contam uma vez.

`room.snapshot.my.last_answer` para reabrir o celular:
- `ordering`: `{order: [id, …]}`;
- `numeric`: `{number}`;
- `word_cloud`: `{words}`.

## 5. Resultados ao vivo (`results.tick`, `room.snapshot`)

- **`word_cloud`:** `word_cloud: {words: [{text, key, n}], distinct, filtered}`, com até 60 palavras em ordem
  decrescente. Vai ao host **e ao telão** sempre, como a enquete. `key` é a forma normalizada (usar como chave do
  React e no `host.hide_word`). Palavras que casam com o filtro de termos (Incremento 4) ou que o host ocultou
  **não aparecem**. `filtered` conta as removidas enquanto a lista das 60 era montada.
- **`numeric`:** `numeric: {min, max, bins[20], n, mean, median}`, com o histograma sobre a faixa do autor. Vai só
  ao host, ou ao telão com `show_live_distribution`. O valor correto não vem.
- **`ordering`:** nada ao vivo além de `answered`.

O snapshot do host e do telão traz os mesmos blocos enquanto a pergunta está aberta ou travada.

## 6. Revelação (`question.reveal`, `room.snapshot.reveal`)

| Tipo | Bloco extra |
|---|---|
| `ordering` | `ordering: {correct_order_ids: [id…], slot_pct_correct: [pct por posição], exact: n}` |
| `numeric` | `numeric: {min, max, bins, n, mean, median, value, tolerance, unit}` |
| `word_cloud` | `word_cloud: {words, distinct, filtered}` (mesma regra do ao vivo) |

`pct_correct`:
- `ordering`: acertos exatos;
- `numeric`: respostas dentro da tolerância;
- `word_cloud`: `null`.

`my` segue igual, com `fraction` para o crédito parcial.
Com `show_correct_on_device` desligado, o celular recebe:
- `ordering.correct_order_ids` e `slot_pct_correct` vazios;
- `numeric.value` e `numeric.tolerance` como `null`.

## 7. Host: ocultar palavra

Comando `host.hide_word {qi, word, hidden?: true}`. `word` é a `key` ou o texto (≤ 25). Vale só na pergunta atual
de nuvem, nas fases `question`, `locked` e `reveal`; fora disso volta o erro `stale`. `hidden: false` mostra a
palavra de novo.

Todos os sockets recebem `word_cloud.update {qi, word_cloud}`. Só o host recebe também `hidden_words: [key…]`, que também vem em `room.snapshot.presenter.hidden_words`. Assim, a lista "Mostrar" funciona de qualquer aparelho, e o cliente troca o bloco `word_cloud` da pergunta
atual (ao vivo ou revelada). A ocultação fica gravada (`live_session.hidden_words`) e vale para reconexões. No
relatório a palavra aparece com `hidden: true`.

## 8. Relatório e "meus resultados"

`GET /sessions/{id}/report`, em `items[]`:
- `ordering`: `ordering: {correct_order[texto], slot_pct_correct, exact, avg_fraction, method}` e `options: []`;
- `numeric`: `numeric: {…histograma, value, tolerance, unit}`;
- `word_cloud`: `word_cloud: {words: [{text, key, n, hidden}], distinct}` e `p: null`.

`GET /api/live/me/results` (e o painel final), em `items[]`:
- `your_answer`:
  - `ordering`: textos na ordem enviada;
  - `numeric`: `"275 bits"`;
  - `word_cloud`: lista de palavras.
- `correct_answer`:
  - `ordering`: textos na ordem certa;
  - `numeric`: `["256 bits (± 10)"]`;
  - `word_cloud`: `null`.

CSV: `ordering` e `numeric` saem com a fração; `word_cloud` com as palavras.

## 9. Banco

`GET /api/live/bank/search` passa a listar PBQs (`question_format: "pbq"`). A PBQ vira `ordering` quando tem uma
tarefa de ordenação de 3 a 6 itens, cada um com até 120 caracteres; senão volta `reject_reason: unsupported_format`.
Nesse caso, `options` traz os itens **na ordem correta**, porque o autor precisa conferir. `prompt` já vem como o item importado vai ficar.

A importação cria o item assim:
- enunciado: `"<título>: <tarefa>"`;
- método: `exact` se a tarefa é exata, senão `kendall`;
- explicação: a da tarefa;
- licença e procedência do Banco.

No conjunto Security+ atual, 1 das 6 PBQs é importável (6 itens, ordem de volatilidade). A seleção automática
(`bank/sample`) continua só com MCQs.

## 10. Migração `0023_live_ga_item_types`

- A CHECK de `live_quiz_item.item_type` passa a aceitar os três tipos novos. No SQLite a tabela é reconstruída.
- Coluna nova `live_session.hidden_words` (JSON).
- O downgrade apaga itens dos tipos novos antes de restaurar a CHECK antiga.

## 11. Acessibilidade (obrigatório no frontend)

- **Ordenar (WCAG 2.5.7):** o arrastar é opcional. Cada item precisa de botões "Mover para cima/baixo" e de uma
  região `aria-live` anunciando a nova posição. Alvos de 44 px.
- **Numérica:** campo de texto com `inputmode="decimal"` e controle deslizante sincronizado. Unidade e faixa
  visíveis. Erro claro quando o valor sai da faixa, antes de enviar.
- **Nuvem:** a lista de palavras também existe como texto, em tabela ou lista oculta para leitores de tela. O
  tamanho e a cor nunca são a única pista: o número aparece ao focar ou passar o mouse.
