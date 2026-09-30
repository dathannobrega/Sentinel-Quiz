# Sentinel Arena: contrato do Incremento 1 (Fundações + núcleo do MVP-0)

Este documento é a **fonte da verdade** entre backend (`backend/app/api/live.py`, `backend/app/live/*`) e
frontend (`web/types/api/live.ts`, `web/features/quiz-live/lib/protocol.ts`). Qualquer mudança de formato
entra aqui primeiro. O plano completo está em [`PLANO.md`](./PLANO.md); a tabela no fim lista o que ficou
para os próximos incrementos.

## 1. Escopo do incremento

| Entra | Fica para depois (ver §9) |
|---|---|
| Quiz: CRUD, itens, reordenar, duplicar, publicar versão com snapshot imutável | IA de criação (`/api/ai/*`), mídia/upload |
| Tipos: `single_choice`, `multi_choice`, `true_false`, `type_answer`, `poll`, `content`, `leaderboard` | `ordering`, `numeric`, `word_cloud` (GA) e tipos F2/F3 |
| Itens do Banco de Questões com `license_scope` (migração 0018) e política de elegibilidade | Auditoria de licença (E0.1), sorteio por blueprint |
| Sessão ao vivo: PIN de 6 dígitos, QR, entrada guest só com nome, código de retorno, entrada logada | Self-paced, times, co-host, controle remoto, ensaio com bots |
| WebSocket `sq.live.v1`: host, telão (display token) e participante; timer do servidor; pontuação por velocidade | Fallback SSE, replay por delta (sempre snapshot), Redis Lua/stream |
| Relatório pós-sessão (KPIs, por item, por participante, por domínio, psicometria p/D/distratores) + CSV | XLSX/PDF, insights de IA, comparação entre sessões |

## 2. Convenções

- Base: `/api/live`. JSON UTF-8. Erros no formato padrão do projeto: `{"detail", "message", "code", "details"?, "request_id"}`.
- Host = usuário autenticado (cookie `sentinel_session`) com permissão de hospedar (`GET /capabilities`).
- Participante = token opaco assinado (HMAC) devolvido no join. Enviado como `Authorization: Bearer <token>`
  no REST e como `hello.token` no WebSocket. **Nunca** na URL.
- Timestamps em ISO-8601 UTC no REST; no WebSocket, **epoch ms** (`*_ms`).
- Toda mutação de quiz exige `expected_version` (lock otimista) → `409 version_conflict` se divergir.

## 3. Tipos de item

| `item_type` | Pontuável | Campos do item (editor) | Resposta do participante (`answer.submit.data`) |
|---|---|---|---|
| `single_choice` | sim | `options[2..6]` com `correct` (≥1 correta) | `{choice: [option_id]}` |
| `multi_choice` | sim (parcial) | `options[2..6]`, ≥1 correta, `all_or_nothing?` | `{choice: [option_id, ...]}` |
| `true_false` | sim | `options` fixas `T`/`F`, exatamente 1 correta | `{choice: [option_id]}` |
| `type_answer` | sim | `accepted_answers[1..10]` (≤60 chars) | `{text: "..."}` |
| `poll` | não | `options[2..6]`, `allow_multiple` | `{choice: [option_id, ...]}` |
| `content` | não | `body` (≤1000 chars) | — |
| `leaderboard` | não | — | — |

Limites: `prompt` ≤ 400 chars (aviso > 120 no editor), texto de opção ≤ 120 (aviso > 60),
`time_limit_s` ∈ [5, 240] ou `null` (sem cronômetro: pontuação fixa, fecha por comando do host),
`points_multiplier` ∈ {0, 1, 2}.

Correção (`score_fraction` ∈ [0,1]):
- `single_choice`/`true_false`: 1 se a opção escolhida é correta.
- `multi_choice`: `max(0, (acertos − erros) / n_corretas)`; `all_or_nothing` → 1 só se o conjunto for exato.
- `type_answer`: 1 se `normalize(texto)` ∈ `normalize(accepted_answers)` (caixa, acentos, espaços e pontuação
  final ignorados). O host pode aceitar uma resposta ao vivo (`host.accept_answer`).

Pontos (quiz `scoring`):
- `speed` (padrão): `t` = ms desde `answers_open_at` menos crédito de latência `min(rtt_min, 300)`;
  `fator = 1 se t < 500 senão 1 − 0,5 × min(t/T, 1)`; `pontos = round(1000 × mult × fator × fraction)`.
- `fixed`: `round(1000 × mult × fraction)`. `none`: 0.
- `streak_bonus` (padrão desligado): `+100 × min(streak − 1, 5)` por acerto total consecutivo.
- Desempate: pontos ↓, acertos ↓, soma dos tempos dos acertos ↑, entrada na sala ↑.

## 4. REST: autoria (host)

### `GET /capabilities`
```json
{"enabled": true, "can_host": true, "reason": null,
 "item_types": ["single_choice","multi_choice","true_false","type_answer","poll","content","leaderboard"],
 "themes": ["sentinel","terminal","neon_soc","aurora","high_contrast"],
 "limits": {"max_participants": 1000, "max_items": 100, "prompt_max": 400, "option_max": 120,
            "options_min": 2, "options_max": 6, "time_limit_min": 5, "time_limit_max": 240}}
```
`reason` quando `can_host=false`: `live_disabled` | `not_allowlisted` | `email_not_verified` | `auth_required`.

### Quiz
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/quizzes` | — | `{"items": [QuizSummary]}` |
| POST | `/quizzes` | `QuizCreate` | `201 QuizDetail` |
| GET | `/quizzes/{quiz_id}` | — | `QuizDetail` |
| PATCH | `/quizzes/{quiz_id}` | `QuizUpdate` (+`expected_version`) | `QuizDetail` |
| DELETE | `/quizzes/{quiz_id}` | — | `204` (arquiva) |
| POST | `/quizzes/{quiz_id}/duplicate` | — | `201 QuizDetail` |
| POST | `/quizzes/{quiz_id}/items` | `ItemWrite` (+`expected_version`, `position?`) | `201 QuizDetail` |
| PATCH | `/quizzes/{quiz_id}/items/{item_id}` | `ItemWrite` parcial (+`expected_version`) | `QuizDetail` |
| DELETE | `/quizzes/{quiz_id}/items/{item_id}?expected_version=N` | — | `QuizDetail` |
| POST | `/quizzes/{quiz_id}/items/reorder` | `{"expected_version", "item_ids": [...]}` | `QuizDetail` |
| POST | `/quizzes/{quiz_id}/items/from-bank` | `{"expected_version", "question_ids": [...]}` | `{"quiz": QuizDetail, "rejected": [{"question_id","reason"}]}` |
| POST | `/quizzes/{quiz_id}/items/{item_id}/review` | `{"expected_version"}` | `QuizDetail` |
| POST | `/quizzes/{quiz_id}/publish` | `{"expected_version"}` | `{"quiz": QuizDetail, "version_no", "published_at", "warnings": [Issue]}` ou `422 quiz_invalid` com `details.issues: [Issue]` |

Mutações de itens devolvem sempre o `QuizDetail` inteiro (versão nova + itens), para o editor não ter
estado divergente.

```ts
QuizSettings = { scoring: "speed"|"fixed"|"none", reading_phase_s: 0..10 (3), grace_ms: 0..1500 (750),
  streak_bonus: bool (false), show_live_distribution: bool (false), show_correct_on_device: bool (true),
  show_explanation: bool (true), leaderboard_every: 0..20 (3; 0 = só no fim), music: bool (true) }
QuizCreate  = { title (1..120), description? (≤500), language? ("pt-BR"|"en"), theme_key?, settings?: Partial<QuizSettings> }
QuizUpdate  = { expected_version, title?, description?, language?, theme_key?, settings?: Partial<QuizSettings> }
QuizSummary = { id, title, description, theme_key, item_count, version, published_version_no|null,
  has_unpublished_changes, created_at, updated_at, last_session: {id, status, created_at}|null }
QuizDetail  = QuizSummary & { language, settings: QuizSettings, items: Item[], can_edit: bool }
ItemWrite   = { item_type, prompt?, options?: [{key?, text, correct?}], accepted_answers?: string[],
  allow_multiple?: bool, all_or_nothing?: bool, body?: string, time_limit_s?: number|null,
  points_multiplier?: 0|1|2, explanation?: string, presenter_notes?: string }
Item        = { id, position, item_type, prompt, options: [{key, text, correct}], accepted_answers,
  allow_multiple, all_or_nothing, body, time_limit_s, points_multiplier, explanation, presenter_notes,
  source_kind: "custom"|"bank"|"ai", source_question_id|null, source_version_id|null,
  license_scope: "own"|"platform"|"pending_audit"|"personal_use", review_state: "ok"|"needs_review",
  domain|null, certification|null, difficulty|null, updated_at }
Issue       = { item_id|null, position|null, field, code, message }
```

Chaves de opção são geradas pelo servidor (`A`..`F`) quando omitidas; em `true_false` são sempre `T`/`F`.

### Banco de Questões
| Método | Rota | Resposta |
|---|---|---|
| GET | `/bank/facets` | `{"certifications": [{"id","label","count"}], "domains": [{"certification","domain","count"}]}` |
| GET | `/bank/search?q=&certification=&domain=&difficulty=&only_guest_eligible=&limit=20&offset=0` | `{"items": [BankItem], "total"}` |

`BankItem = { question_id, prompt, options: [{key, text}], multi_select, certification, domain, difficulty,
license_scope, guest_eligible, convertible_to: "single_choice"|"multi_choice"|"true_false"|null, reject_reason|null }`
(sem gabarito; o gabarito só aparece no editor depois de adicionado). Itens `personal_use` nunca aparecem.

### Sessões (host)
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/sessions` | `{quiz_id, allow_guests?: true, max_participants?, preset?: "turma"\|"evento", audience?: "adulto"\|"misto"\|"infantojuvenil"}` | `201 Session` ou `422 license_requires_login` (`details.items`) / `409 quiz_not_published` |
| GET | `/sessions?quiz_id=` | — | `{"items": [Session]}` |
| GET | `/sessions/{session_id}` | — | `Session` |
| POST | `/sessions/{session_id}/display-token` | — | `{"token", "expires_at"}` |
| POST | `/sessions/{session_id}/end` | — | `Session` |
| GET | `/sessions/{session_id}/qr.svg` | — | `image/svg+xml` (download/impressão) |
| GET | `/sessions/{session_id}/report` | — | `Report` |
| GET | `/sessions/{session_id}/export.csv` | — | `text/csv` |

```ts
Session = { id, quiz_id, quiz_title, version_no, status: "lobby"|"live"|"finished", phase, join_code,
  join_url, allow_guests, max_participants, preset, audience, theme_key, item_count, participant_count,
  created_at, started_at|null, ended_at|null }
```
`join_url` = `${PUBLIC_WEB_ORIGIN}/j/${join_code}`.

## 5. REST: participante (público)

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/rooms/{code}` | — | `RoomInfo` ou `404 room_not_found` |
| POST | `/rooms/{code}/join` | `{display_name, consent: true, avatar_seed?, dev_h?}` | `201 JoinResult` |
| POST | `/rooms/{code}/rejoin` | `{display_name, return_code}` | `JoinResult` (sem `return_code`) |
| GET | `/names/suggest?lang=pt-BR` | — | `{"name": "Firewall Veloz"}` |
| GET | `/me/results` | Bearer token do participante | `MyResults` |

```ts
RoomInfo   = { session_id, code, title, status, phase, allow_guests, requires_login, accepting_joins,
  theme_key, participant_count, consent_version }
JoinResult = { session_id, participant_id, token, expires_at, return_code?, display_name, avatar_seed }
MyResults  = { session_id, title, display_name, rank, participant_count, score, correct, answered,
  total_scored, items: [{position, prompt, item_type, correct: bool|null, fraction|null, points,
  your_answer: string[]|string|null, correct_answer: string[]|null, explanation|null}] }
```

Erros de join: `room_not_found` (404), `room_locked` (423), `room_full` (409), `session_finished` (410),
`login_required` (401), `name_taken` (409), `name_rejected` (422), `consent_required` (422),
`invalid_return_code` (403). Nome: 2–24 caracteres após normalização; bloqueio de termos ofensivos
(pt-BR/en, com leetspeak).

Logado: se o join vier com cookie de sessão válido, o participante é vinculado ao `user_id` (sem
`return_code`). Em `audience="infantojuvenil"` o nome digitado é ignorado e um apelido gerado é usado.

## 6. WebSocket `sq.live.v1`

`wss://<host>/api/live/ws`, subprotocolo `sq.live.v1`. Envelope:

- Cliente → servidor: `{"v":1, "type", "mid"?, "data"}`.
- Servidor → cliente: `{"v":1, "type", "seq"?, "sts", "data"}` (`sts` = hora do servidor em epoch ms;
  `seq` = sequência de estado da sala, crescente; eventos sem mudança de estado não têm `seq`).

Handshake: o primeiro frame **deve** ser `hello` em até 5 s.

| Papel | `hello.data` |
|---|---|
| participante | `{"token": "<participant token>"}` |
| display (telão) | `{"token": "<display token>"}` |
| host | `{"session_id": "...", "role": "host"}` + cookie de sessão (Origin validado) |

Resposta: `welcome` e logo em seguida `room.snapshot`. Após qualquer reconexão o servidor sempre manda um
`room.snapshot` autoritativo: o cliente **substitui** o estado local.

### Cliente → servidor
| type | Papel | data |
|---|---|---|
| `hello` | todos | ver acima |
| `time.sync` | todos | `{t0}` → resposta `time.sync.reply {t0, t1, t2}` (ms) |
| `pong` | todos | `{ts}` (eco de `srv.ping`) |
| `answer.submit` | participant | `{answer_id (uuid), qi, choice?: string[], text?: string, client_elapsed_ms?}` |
| `host.start` | host | `{}` (lobby → primeiro item) |
| `host.next` | host | `{expected_qi}` (próximo item, ou pódio no último) |
| `host.lock` | host | `{expected_qi}` |
| `host.reveal` | host | `{expected_qi}` (tranca antes, se necessário) |
| `host.leaderboard` | host | `{}` |
| `host.end` | host | `{}` |
| `host.kick` | host | `{participant_id, ban?: bool}` |
| `host.room_lock` | host | `{locked: bool}` |
| `host.accept_answer` | host | `{qi, text}` (só `type_answer`, após o lock) |

### Servidor → cliente
| type | Para | data |
|---|---|---|
| `welcome` | todos | `{role, session_id, me?: {participant_id, display_name, avatar_seed}, hb_ms, proto: 1}` |
| `room.snapshot` | todos | `Snapshot` (abaixo), sanitizado por papel |
| `lobby.update` | todos | `{count, recent: [{participant_id, display_name, avatar_seed}]}` |
| `question.intro` | todos | `{qi, total, question: PublicQuestion, answers_open_at_ms, deadline_ms\|null}` |
| `answer.ack` | participant | `{answer_id, qi, status: "accepted"\|"duplicate"\|"already_answered"\|"late"\|"closed"\|"invalid"}` |
| `results.tick` | host, display | `{qi, answered, total, counts?: {option_id: n}}` (counts: host sempre; display se `show_live_distribution` ou `poll`) |
| `participant.progress` | participant | `{qi, answered, total}` |
| `question.locked` | todos | `{qi, reason: "timer"\|"all_answered"\|"host"}` |
| `question.reveal` | todos | `Reveal` + `my?` (personalizado por participante) |
| `leaderboard.show` | todos | `{top: [Standing], total, my?: {rank, score, behind_by}}` |
| `podium.show` | todos | `{top: [Standing] (até 3), stats: {participants, avg_pct, hardest_qi\|null}, my?}` |
| `session.ended` | todos | `{report_available: bool}` |
| `room.locked` | todos | `{locked}` |
| `participant.kicked` | participant alvo | `{banned}` e close 4003 |
| `srv.ping` | todos | `{ts}` |
| `error` | remetente | `{code: "stale"\|"forbidden"\|"invalid"\|"too_early"\|"rate_limited"\|"not_found", ref_mid?, detail?}` |

```ts
Phase = "lobby" | "question" | "locked" | "reveal" | "leaderboard" | "content" | "podium" | "finished"
PublicQuestion = { qi, item_type, prompt, options: [{id, text, index}], allow_multiple, body|null,
  time_limit_s|null, points_multiplier, scored: bool, select_count|null /* multi: nº de corretas */ }
Reveal = { qi, item_type, correct_option_ids: string[], accepted_answers: string[], counts: {option_id: n},
  answered, total, pct_correct|null, avg_ms|null, fastest?: {display_name, ms}|null,
  explanation|null, top_answers?: [{text, n, accepted}] /* type_answer */,
  my?: {answered, correct|null, fraction|null, points, total_score, rank, rank_delta, streak} }
Standing = { rank, participant_id, display_name, avatar_seed, score, correct, delta }
Snapshot = { session_id, title, theme_key, join_code, join_url, status, phase, qi|null, total,
  settings: {scoring, show_live_distribution, show_correct_on_device, show_explanation, music, reading_phase_s},
  room_locked, participant_count,
  question?: PublicQuestion, timer?: {answers_open_at_ms, deadline_ms|null},
  answered?: number,                // host/display
  counts?: {option_id: n},          // host sempre; display conforme regra
  reveal?: Reveal, leaderboard?: {top, total}, podium?: {top, stats},
  lobby?: {count, recent},
  presenter?: {item: Item (com gabarito e notas), next_prompt|null},   // só host
  participants?: [{participant_id, display_name, avatar_seed, score, connected}],  // só host
  my?: {participant_id, display_name, avatar_seed, answered_current: bool, last_answer?,
        score, rank|null} }         // só participante
```

Códigos de fechamento: 1008 Origin inválido · 1009 frame > 16 KB · 4001 autenticação · 4002 token
expirado · 4003 expulso · 4004 banido · 4008 sala cheia · 4010 sessão encerrada · 4011 protocolo ·
4029 rate limit (20 msg/s, rajada 40).

Timer: `answers_open_at_ms = intro + reading_phase_s`; aceita-se resposta até `deadline + grace_ms`.
O servidor tranca sozinho no prazo e antecipa quando todos os participantes responderam.
Relógio do cliente: `offset` pela amostra de menor RTT entre 5 `time.sync` no início; exiba o tempo como
`deadline_ms − (performance-based now + offset)`.

## 7. Relatório (`GET /sessions/{id}/report`)

```ts
Report = { session: Session, generated_at,
  kpis: { participants, scored_items, answered_rate, completion_rate, avg_score_pct, median_score_pct, avg_response_ms,
          kr20|null },
  items: [{ position, item_type, prompt, scored, answered, n_correct, p|null, discrimination|null,
            avg_ms|null, median_ms|null, flags: ("too_easy"|"too_hard"|"negative_discrimination"|"low_discrimination"|"distractor_dominant")[],
            options: [{key, text, correct, count, pct, upper_pct|null, lower_pct|null}],
            top_answers?: [{text, n, accepted}], domain|null }],
  participants: [{ participant_id, display_name, is_guest, rank, score, correct, answered, score_pct,
                   avg_ms|null }],
  domains: [{ certification|null, domain, items, answers, pct_correct, band: "not_ready"|"approaching"|"ready"|"insufficient_data" }] }
```

`p` = proporção de acerto; `discrimination` = D (27% superior − 27% inferior, com N ≥ 10); flags seguem a
§14 do plano (p > 0,9 fácil, p < 0,2 difícil, D < 0 negativa, D < 0,2 baixa, distrator com mais escolhas
que a correta).

## 8. Configuração

| Setting | Padrão | Observação |
|---|---|---|
| `LIVE_ENABLED` | `false` | liga rotas e UI (compose de dev: `true`) |
| `LIVE_HOST_POLICY` | `allowlist` | `allowlist` / `verified_users` / `all` (admin sempre pode) |
| `LIVE_HOST_ALLOWLIST` | vazio | e-mails ou ids separados por vírgula |
| `LIVE_MAX_PARTICIPANTS` | 1000 | teto por sala |
| `LIVE_TOKEN_KEYS` | vazio | `kid:segredo[,kid:segredo]`; o primeiro assina. Obrigatório em produção com `LIVE_ENABLED` |
| `LIVE_BUS_BACKEND` | `memory` | `memory` (1 processo) / `redis` (obrigatório com mais de 1 worker) |
| `LIVE_REDIS_URL` | `REDIS_URL` | pub/sub das salas |
| `LIVE_PLATFORM_GUEST_OK` | `false` | itens `platform` em salas com guests (Q-19) |
| `LIVE_GRACE_MS_DEFAULT` | 750 | |
| `LIVE_WS_MAX_MESSAGE_BYTES` | 16384 | |

## 9. Fora deste incremento (próximos)

1. IA de criação (`/api/ai/*`, `ai_job`, crítico, revisão) — E0.8/MVP-0.
2. Redis Lua + stream + persister (aceite em memória) quando o k6 mostrar que o INSERT síncrono não segura
   1.000 respostas em 2 s — a interface `AnswerSink` já isola a troca.
3. Fallback SSE, replay por delta, pausa/extensão, sala de espera com aprovação, tempo estendido por participante.
4. Mídia (upload, moderação), temas F2, som completo, controle remoto, ensaio com bots.
5. Self-paced, XLSX/PDF, insights de IA, claim de guest para conta, LGPD self-service (`/me` DELETE).
