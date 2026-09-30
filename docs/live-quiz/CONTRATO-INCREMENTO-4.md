# Sentinel Arena: contrato do Incremento 4 (moderação, direitos do participante e operação)

Complementa os contratos dos Incrementos [1](./CONTRATO-INCREMENTO-1.md), [2](./CONTRATO-INCREMENTO-2.md) e
[3](./CONTRATO-INCREMENTO-3.md). A fonte da verdade é o backend: `backend/app/api/live.py`,
`backend/app/api/live_admin.py` e `backend/app/services/live_{admin,rights,moderation,retention,preflight}.py`.

## 1. Escopo

| Entra (MVP-0, §17.2) | Fica para depois |
|---|---|
| Termos do filtro geridos pelo admin (RF-1107) | Classificação de segurança por IA na publicação (RF-1112, 2ª camada) |
| Moderação do conteúdo na publicação (RF-1112) | Moderação de imagens (RF-1113): o editor ainda não aceita upload |
| Denúncia pelo participante (RF-1104) e fila de moderação (RF-1114) | Plantão/alertas externos: o log `live_preflight_failed` é o gancho |
| Painel admin "Arena" (RF-1102) e encerramento forçado (RF-1103) | Pedido de dados mediado pelo owner (sem código de retorno) |
| Auditoria de relatório nominal e export (RF-1110) | |
| "Meus dados", exclusão (RF-650), acesso com código de retorno, claim para a conta (RF-633) | |
| Prévia do celular no ensaio (RF-514), checagem pré-evento (RF-1115), aviso de 80% (RF-1205) | |
| Retenção com anonimização e expurgo (RF-1109) | |

## 2. Moderação de conteúdo

- **Na publicação:** `POST /api/live/quizzes/{id}/publish` passa a devolver
  `moderation: {state: "clear" | "flagged", findings: [{position, field, term, excerpt}]}`. Termos encontrados em
  enunciado, alternativas, respostas aceitas, explicação ou corpo de slide deixam a versão como `flagged` e abrem um
  caso `filter`. A publicação acontece do mesmo jeito.
- **Sessão com convidados** de versão `flagged`: `422 moderation_pending`, com `details.findings`.
  Sessões só para usuários logados continuam permitidas.
- **Quiz bloqueado:** `403 quiz_blocked` ao criar sessão.
- **Respostas digitadas ofensivas** aparecem no telão como `{"text": "•••", "masked": true}` em
  `question.reveal.top_answers`. Uma resposta aceita pelo autor nunca é mascarada.
- **Remoção durante a sessão:** a posição removida vira um slide neutro. `public_question` passa a ter
  `removed: true`, com `prompt: ""`, e o item não pode ser respondido nem pontua. Se for a pergunta aberta, a fase
  vai para `content`. Todos os sockets recebem `item.removed {qi, current}` (seq) e, logo depois, um
  `room.snapshot` novo. Sessões novas da mesma versão herdam a remoção.

## 3. Participante

| Método | Rota | Auth | Resposta |
|---|---|---|---|
| GET | `/api/live/me` | Bearer do participante | `{participant, session, answers[], retention, claim: {available, reason, until?}}` |
| DELETE | `/api/live/me` | Bearer | `{erased: true}`. Anonimiza na hora, fecha o socket (`participant.kicked`) e tira a pessoa do ranking e dos relatórios |
| POST | `/api/live/me/access` | — | `{session_id, display_name, return_code}` → mesmo formato do join (token novo). Funciona com a sessão encerrada. `403 invalid_return_code`; `429 too_many_attempts` após 10 erros por (sessão, nome) em 15 min |
| POST | `/api/live/me/claim` | cookie da conta + `{token}` no corpo | `{claimed: true, bank_answers_recorded: n}`. Erros `409 claim_session_active`, `claim_already_linked`, `claim_expired` (7 dias após o fim), `claim_not_available` (infantojuvenil) e `claim_already_in_session` |
| POST | `/api/live/me/report` | Bearer | `{target: "session" \| "item", qi?, reason: offensive\|spam\|cheating\|copyright\|privacy\|other, note?}` → `202 {report_id}`. Com 5 denúncias abertas: `429 too_many_reports` |

`claim.reason`: `session_active`, `already_linked`, `expired` ou `not_available`.

## 4. Host

| Método | Rota | Resposta |
|---|---|---|
| POST | `/api/live/sessions/{id}/preview` | Só em ensaio (`409 preview_requires_rehearsal`). Devolve o mesmo formato do join, com o participante "Prévia" (reutilizado), que fica fora dos relatórios. O frontend abre o cliente do participante com esse token |
| GET | `/api/live/sessions/{id}/preflight` | `{status: "ready" \| "attention", large_room, checks: [{key, status: ok\|warn\|fail, detail, values?}]}`. Checagens: `database`, `capacity` (`near_limit`, `above_platform_limit`), `content` (`moderation_pending`, `quiz_blocked`), `realtime_bus`, `rate_limit` (`memory_backend`), `token_keys` (`dev_key`), `event_loop` (`lagging`) |

`room.snapshot` passa a ter `max_participants` e `rehearsal`; `participants[]` (host) ganha `is_preview`.
O host deve ver um aviso quando `participant_count ≥ 80%` de `max_participants` (RF-1205).
`GET /sessions/{id}/report` ganha `retention: {events_purged_at, snapshot}`. Quando `snapshot` é true, o relatório é
o retrato congelado antes do expurgo. Abrir o relatório ou exportar fica auditado.

## 5. Admin (`/api/admin/live`)

Moderador = `reviewer` ou `admin`. As ações marcadas com **A** exigem `admin`.

| Método | Rota | Corpo / resposta |
|---|---|---|
| GET | `/overview` | `{active_sessions: [{id, join_code, quiz_title, owner_email, status, phase, rehearsal, allow_guests, participants, online, max_participants, created_at, started_at}], totals: {active_sessions, participants, online, open_cases}}` |
| GET | `/cases?status=open\|dismissed\|actioned\|all&limit&offset` | `{items: [{id, source: participant\|filter\|admin, status, reason, note, excerpt, details, quiz_id, quiz_title, owner_email, quiz_version_id, session_id, join_code, position, created_at, resolved_at, resolution, resolution_note}], total}` |
| POST | `/cases/{id}/resolve` | `{action: dismiss\|approve\|remove_item\|end_session(A)\|block_quiz(A), note?}`. `remove_item`, `end_session` e `block_quiz` exigem `note` com ≥5 caracteres (`422 reason_required`). Resposta: `{resolved, sessions_affected[]}`. `409 case_closed` |
| POST | `/sessions/{id}/end` **A** | `{reason}` → `{ended: true}` (`409 session_not_active`) |
| GET | `/sessions/{id}/report?reason=` **A** | Relatório de outro owner, só com motivo (auditado) |
| POST | `/quizzes/{id}/unblock` **A** | `{reason}` |
| GET / POST / DELETE | `/terms`, `/terms/{id}` (escrita **A**) | `{term, match: token\|substring, kind: block\|allow, scope: names\|content\|all, note?}`. Vale em ≤30 s em todos os processos |
| GET | `/audit?session_id=&limit=` **A** | `{items: [{id, action, actor_email, actor_kind, session_id, quiz_id, target, reason, meta, created_at}]}` |
| POST | `/retention/run` **A** | Resumo da execução |

Ações auditadas: `force_end`, `case_*`, `term_added`, `term_removed`, `quiz_unblocked`, `report_view`,
`export_csv`, `admin_report_view`, `participant_erased`, `participant_claimed`, `retention_anonymize`,
`retention_purge` e `retention_manual_run`.

## 6. Retenção (RF-1109)

`LIVE_RETENTION_NAMES_DAYS` (180): nomes viram "Participante N"; tokens, códigos e hashes são apagados.
`LIVE_RETENTION_EVENTS_DAYS` (365, entre 30 e 730): o relatório é congelado em `report_snapshot_json` e o log
de respostas é apagado. A janela de nomes nunca é maior que a de eventos, então o retrato já sai anônimo.
O job roda com `docker/entrypoint.sh live-cleanup`, uma vez por dia.

## 7. Migração `0022_live_moderation`

Tabelas `live_moderation_term`, `live_moderation_case` e `live_audit_event`. Colunas novas:
- `live_quiz.blocked_at`;
- `live_quiz_version.moderation_state` e `moderation_json`;
- `live_session.hidden_positions`, `names_anonymized_at`, `events_purged_at` e `report_snapshot_json`;
- `live_participant.is_preview`, `erased_at` e `claimed_at`.
