# Sentinel Arena: contrato do Incremento 6 (desafio self-paced)

Complementa os contratos dos Incrementos [1](./CONTRATO-INCREMENTO-1.md) a [5](./CONTRATO-INCREMENTO-5.md).
A fonte da verdade é o backend:
- `backend/app/services/live_challenge.py`: regras do desafio;
- `backend/app/api/live_challenge.py`: rotas;
- testes em `backend/tests/test_live_challenge.py`.

## 1. Escopo (E1.10, jornada J5, RF-801..RF-813, RF-1029)

| Entra | Fica para depois |
|---|---|
| Criar desafio de um quiz publicado, com link permanente `/q/{slug}` e QR | E-mail de resumo ao fechar (F2) |
| Abertura e prazo; 1 a 5 tentativas; tempo por item, total ou livre | Modo prática (RF-811) e modo híbrido (RF-812) |
| Itens e opções embaralhados por tentativa | Times |
| Correção conforme a política: a cada item, no fim, após o prazo ou nunca | Sinal de IP /24 no anti-fraude |
| Ranking provisório e final, com anti-fraude (RF-813) | |
| Retomar de onde parou; painel do owner com funil; relatório | |

O desafio é uma `live_session` com `mode: "self_paced"`. Ele não usa WebSocket: o participante anda pelos itens
via REST, e todo prazo é avaliado quando alguém acessa (deadline preguiçoso).

## 2. Owner

### Criar: `POST /api/live/challenges`

```json
{
  "quiz_id": "…",
  "opens_at": "2026-10-02T12:00:00Z",
  "closes_at": "2026-10-09T23:59:00Z",
  "attempts": 1,
  "time_mode": "per_item",
  "total_time_s": null,
  "feedback": null,
  "leaderboard": false,
  "shuffle_items": true,
  "allow_guests": true,
  "audience": "adulto",
  "max_participants": null
}
```

| Campo | Regra |
|---|---|
| `opens_at` | Opcional. Padrão: agora |
| `closes_at` | Obrigatório. Futuro, depois de `opens_at`, no máximo 90 dias depois dele |
| `attempts` | 1 a 5 |
| `time_mode` | `per_item` (tempo de cada item, multiplicado pelo tempo estendido do participante), `total` (com `total_time_s` entre 60 e 14.400) ou `none` |
| `feedback` | `each` \| `end` \| `after_close` \| `never`. Padrão: `after_close` com ranking (RF-813), `end` sem ranking |

Resposta: o `serialize_session` de sempre, com `mode: "self_paced"` e `challenge`:

```json
{"slug": "7K3QH2XN", "share_url": "https://…/q/7K3QH2XN", "state": "scheduled|open|closed",
 "opens_at": "…", "closes_at": "…", "attempts": 1, "time_mode": "per_item", "total_time_s": null,
 "feedback": "end", "leaderboard": false, "shuffle_items": true}
```

Sessões ao vivo agora também trazem `mode: "live"` e `challenge: null`.

Os gates do ao vivo valem igual:
- `quiz_not_published`;
- `license_requires_login` / `license_blocked`;
- `moderation_pending`, `quiz_blocked`;
- `no_interactive`.

Também volta `invalid_window`, `invalid_total_time`, `invalid_attempts` ou `invalid_feedback`.

### Painel: `GET /api/live/sessions/{id}/challenge`

Pensado para poll de 10 s (RF-809):

```json
{
  "challenge": { "…": "como acima" },
  "funnel": {"opened": 40, "joined": 31, "started": 30, "finished": 27},
  "in_progress": 3,
  "attempts": 33,
  "attempts_per_person": {"1": 28, "2": 2},
  "repeat_suspects": 1,
  "median_duration_ms": 312000,
  "recent": [{"participant_id": "…", "display_name": "Ana", "attempt_no": 1, "score": 4200, "correct": 5,
              "finished_at": "…", "finish_reason": "completed|time_up|closed|handed_in", "repeat_suspect": false}],
  "leaderboard": [{"rank": 1, "participant_id": "…", "display_name": "Ana", "avatar_seed": "…", "score": 4200, "correct": 5}],
  "generated_at": "…"
}
```

`opened` conta as aberturas do link sem token.

### Alterar: `PATCH /api/live/sessions/{id}/challenge`

- `{closes_at}` adia ou antecipa o prazo. As tentativas abertas com tempo total respeitam o novo fim.
- `{close_now: true}` fecha agora.

A resposta é o painel. Com o desafio já fechado volta `409 challenge_closed`.

### Rotas existentes

- `POST /sessions/{id}/end` fecha o desafio, assim como o encerramento pelo admin.
- `GET /sessions/{id}/qr.svg` aponta para `share_url`.
- `POST /sessions/{id}/display-token` volta `409 not_a_live_room`. O desafio não tem telão nem apresentador.

### Relatório (`GET /sessions/{id}/report`)

- Conta **uma tentativa por participante**: a melhor concluída (pontos, acertos, acertos mais rápidos, quem
  entrou primeiro).
- Quem não concluiu nenhuma tentativa fica fora do relatório; o funil mostra essa diferença.
- Campos novos:
  - `challenge`: `{challenge, funnel, attempts, attempts_per_person, repeat_suspects, median_duration_ms}`;
  - `participants[].repeat_suspect` (RF-813).

## 3. Participante (`/q/{slug}`)

O slug tem 8 caracteres Crockford Base32. A busca ignora maiúsculas e aceita O no lugar de 0 e I/L no lugar de 1.
Todas as rotas abaixo, exceto a primeira, `join` e `access`, exigem `Authorization: Bearer <token do participante>`.

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/live/q/{slug}` | `{session_id, slug, title, theme_key, state, opens_at, closes_at, server_now, item_count, attempts, time_mode, total_time_s, feedback, leaderboard, requires_login, allow_guests, audience, consent_version}`. Sem token, conta uma abertura |
| POST | `/api/live/q/{slug}/join` | Mesmo corpo e resposta do join ao vivo (`token`, `return_code`…). Erros: `409 challenge_not_open`, `410 challenge_closed`, `401 login_required`, `409 name_taken`, `422 name_rejected`. O token vale até o fechamento + 1 dia (máximo 31 dias) |
| POST | `/api/live/q/{slug}/access` | `{display_name, return_code}`: token novo, também depois do fechamento |
| POST | `/api/live/q/{slug}/attempts` | Começa uma tentativa ou **retoma** a aberta (RF-808) → `AttemptState`. `409 attempts_exhausted`, `409 challenge_not_open`, `410 challenge_closed` |
| GET | `/api/live/q/{slug}/attempts/current` | A tentativa aberta; se não houver, a última concluída (com `summary`); `404 attempt_not_found` antes da primeira |
| POST | `/api/live/q/{slug}/attempts/{aid}/answers` | `{answer_id, qi, choice?, text?, words?, number?}` (mesma forma do `answer.submit`) → `{status, state, feedback?}` |
| POST | `/api/live/q/{slug}/attempts/{aid}/advance` | `{index}`: sai de um slide de conteúdo. Idempotente: só avança se `index` for o atual |
| POST | `/api/live/q/{slug}/attempts/{aid}/finish` | Entrega antes do fim: o resto fica sem resposta → `AttemptState` |
| GET | `/api/live/q/{slug}/leaderboard` | `{top: [10], total, me, final}`. `404 leaderboard_disabled` sem ranking |

`status` da resposta:

| Status | Significado |
|---|---|
| `accepted` | Gravada |
| `duplicate` | O mesmo `answer_id` já foi gravado |
| `invalid` | Formato errado; o item continua aberto |
| `late` | O prazo do item ou o total passou; o estado já mostra o próximo item ou o fim |
| `stale` | `qi` não é o item atual |
| `already_answered` | Item já respondido |
| `closed` | A tentativa já terminou |

O cliente sempre passa a usar o `state` devolvido.

### `AttemptState`

```json
{
  "attempt_id": "…", "attempt_no": 1, "attempts_allowed": 2, "status": "in_progress|finished",
  "index": 2, "total": 6, "questions_total": 5,
  "started_at": "…", "deadline_at": "… (só com time_mode total)", "closes_at": "…", "server_now": "…",
  "feedback": "end", "leaderboard": false,
  "item": { "…": "PublicQuestion do ao vivo; opções na ordem desta tentativa, com index refeito" },
  "item_started_at": "…",
  "item_deadline_at": "… | null",
  "summary": { "…": "só quando status = finished" }
}
```

- **Cronômetro:** use `server_now` para corrigir o relógio local. `item_deadline_at` já considera o tempo estendido
  e o fim do desafio. Há 1,5 s de folga no servidor. Ao zerar, chame `attempts/current` (o item expira sozinho) ou
  mostre "tempo esgotado".
- **Conteúdo:** `item.item_type = "content"` traz `prompt` e `body`, com botão "Continuar" (`advance`).
- **Itens:** tipos e payloads iguais ao ao vivo, incluindo os do Incremento 5. Placar intermediário e itens
  removidos pela moderação nunca aparecem.

### Correção (`feedback` na resposta e `summary.items`)

Com a política `each`, cada resposta `accepted` traz:

```json
{"qi": 3, "item_type": "single_choice", "answered": true, "correct": false, "fraction": 0, "points": 0,
 "correct_option_ids": ["o_…"], "accepted_answers": [], "correct_order_ids": ["…"] , "numeric": {"value": 256, "tolerance": 10, "unit": "bits"},
 "explanation": "…", "your_answer": {"choice": ["o_…"]}}
```

- `correct_order_ids` só vem em `ordering`; `numeric`, só em `numeric`.
- `your_answer` pode ser `{choice}`, `{text}`, `{order}`, `{number}` ou `{words}`.

### `summary`

```json
{"score": 4200, "correct": 5, "answered": 6, "questions": 6, "scored_questions": 5, "duration_ms": 312000,
 "finish_reason": "completed|time_up|closed|handed_in", "attempts_left": 1, "best_score": 4200,
 "rank": 3, "ranked": 27, "corrections_visible": true, "corrections_at": "… (after_close)",
 "items": [ {"…": "correção como acima", "prompt": "…", "question": {"…": "PublicQuestion"}} ]}
```

`rank` só vem com ranking. `items` fica vazio enquanto a política não libera a correção:

| Política | Quando libera |
|---|---|
| `each` | Sempre |
| `end` | Ao concluir a tentativa |
| `after_close` | Depois do prazo; mostre `corrections_at` |
| `never` | Nunca |

Depois do prazo, `attempts/current` traz a correção liberada.

`/api/live/me/results` e `/api/live/me` respeitam a mesma política. `/me/results` ganha `mode`,
`corrections_visible` e `corrections_at`.

## 4. Anti-fraude (RF-813)

- O nome é único por desafio, como no ao vivo.
- Com o mesmo `dev_h` (o identificador do aparelho que o join ao vivo já manda), um segundo participante pode
  jogar, mas a tentativa fica marcada `repeat_suspect`. O painel e o relatório mostram a marca.
- Com ranking, a correção fica oculta até o prazo por padrão. Recomende "exigir login" na tela de criação.

## 5. Migração `0024_live_self_paced`

- `live_session`: `share_slug` (único), `opens_at`, `closes_at`, `view_count`.
- `live_answer_event.attempt_no`, com padrão 1. A chave "uma resposta por item" passa a incluir a tentativa.
- Tabela `live_attempt`.

## 6. Telas (frontend)

| Tela | Conteúdo |
|---|---|
| **Criar desafio** | Ação no quiz publicado, ao lado de "Apresentar". Datas de abertura e prazo com atalhos (1 dia, 1 semana), tentativas, tempo, política de correção, ranking (com o aviso do RF-813), embaralhar e "exigir login". Ao criar, mostra link, QR e "Copiar" |
| **Painel do desafio** | Poll de 10 s: estado, prazo com "Adiar" e "Fechar agora", funil, em andamento, ranking, conclusões recentes com a marca de repetição, link e QR, "Ver relatório" |
| **Participante `/q/{slug}`** | Mesmo layout leve do `/j/{code}`. Estados `scheduled` (contagem para a abertura), `open` (nome e consentimento, ou "Continuar" quando já há token) e `closed` (acesso aos resultados com o código de retorno). Jogo item a item com barra de progresso, cronômetro, "Entregar" e os mesmos componentes de resposta do ao vivo. Correção por item quando `each`. Tela final com resumo, posição, correção conforme a política e "Tentar de novo" se sobrar tentativa |
| **Listas e relatório** | Sessões mostram "Desafio" e o estado. O relatório ganha o funil, a distribuição de tentativas e a marca de repetição |
