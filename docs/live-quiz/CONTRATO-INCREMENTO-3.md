# Sentinel Arena: contrato do Incremento 3 (resiliência e operação ao vivo)

Complementa os contratos dos [Incrementos 1](./CONTRATO-INCREMENTO-1.md) e [2](./CONTRATO-INCREMENTO-2.md).
Fonte da verdade entre backend (`backend/app/live/*`, `backend/app/api/live.py`) e frontend
(`web/types/api/live.ts`, `web/features/quiz-live/lib/protocol.ts`).

## 1. Escopo

| Entra | Fica para depois |
|---|---|
| Carga de 1.000 participantes a partir de um IP (harness `scripts/live/loadtest.py`) | k6 fora do host, soak de 2 h, caos (réplica/Redis caindo) |
| Rate limit por sala e por token, nunca por IP (DC-22); guarda contra adivinhação de PIN | Sala de espera acima do teto |
| Respostas em *group commit*; `lobby.update` e `participant.progress` agregados por tick | Redis Lua/stream como caminho quente (§10) |
| Fallback SSE + POST (RNF-309) | Replay por delta (`resume` com `last_seq`) |
| Pausar, retomar e estender o tempo; tempo estendido por participante (RF-622) | Tempo estendido pré-configurado por perfil de conta |
| Ensaio com bots (RF-513) | Pré-visualização como participante (RF-514) |
| `GET /api/live/metrics` (RNF-1001) | Profile `observability` (Prometheus/Grafana) |

## 2. Rate limit (DC-22)

| Rota | Chave | Padrão | Setting |
|---|---|---|---|
| `GET /rooms/{code}`, `POST /rooms/{code}/join`, `/rejoin` | código da sala | 6.000/min | `RATE_LIMIT_LIVE_ROOM_*` |
| `GET /me/*` | hash do token do participante | 30/min | `RATE_LIMIT_LIVE_TOKEN_*` |
| `GET /sse`, `POST /cmd` | hash do token (host: IP) | 300/min | `RATE_LIMIT_LIVE_CMD_*` |
| `/names/suggest`, `/capabilities`, `/healthz` | IP | 3.000/min | `RATE_LIMIT_LIVE_IP_*` |

Adivinhação de PIN: cada `404` em `/rooms/*` conta por IP. Ao passar de `LIVE_INVALID_CODE_LIMIT` (60) em
`LIVE_INVALID_CODE_WINDOW_SECONDS` (600 s), o IP recebe `429 too_many_invalid_codes` para **códigos novos**.
As salas que esse IP já alcançou continuam abertas, para que alguns erros de digitação numa turma atrás de
um NAT não bloqueiem todo mundo.

## 3. Fallback SSE + POST (RNF-309)

O cliente usa o WebSocket. Se o socket não abrir, ou cair duas vezes seguidas antes do `welcome` em ≤5 s,
ele passa para:

- **`GET /api/live/sse`** (`EventSource`): `?token=<participante|telão>` ou, para o host,
  `?session_id=<id>&role=host` com o cookie de sessão (`withCredentials`) e `Origin` confiável.
  Cada evento `data:` traz **um frame do servidor idêntico ao do socket** (`welcome` com
  `transport: "sse"`, `room.snapshot`, broadcasts…). `event: close` traz `{"code": n}` (4003 removido,
  4004 banido, 1012 reciclagem) e encerra o stream. Linhas `: keepalive` a cada 15 s.
  O stream é reciclado após `LIVE_SSE_MAX_SECONDS` (300 s) com `close` 1012. O `EventSource` reconecta
  sozinho e recebe um snapshot novo.
- **`POST /api/live/cmd`**: `{"auth": {"token"?, "session_id"?, "role"?: "host"}, "frame": <frame do cliente>}`.
  O token do participante também pode ir como `Authorization: Bearer`, que é a chave do rate limit.
  Resposta `200 {"frames": [...]}` com as respostas destinadas ao remetente (`answer.ack`, `error`,
  `time.sync.reply`). Os broadcasts chegam pelo stream. `hello` não é aceito, porque é implícito.
  Autenticação inválida: `401`/`403 {"code": "live_auth", "details": {"close_code": n}}`.
- Sem `pong` nem RTT no SSE: o crédito de latência é 0.

## 4. Controle do tempo (host)

| Comando (`host.*`) | `data` | Efeito |
|---|---|---|
| `host.pause` | `{expected_qi}` | Congela a pergunta aberta. Não há auto-lock e respostas recebem `answer.ack.status = "paused"` |
| `host.resume` | `{expected_qi}` | Leitura e prazo avançam pelo tempo pausado: sobra o mesmo tempo e a velocidade ignora a pausa |
| `host.extend` | `{expected_qi, seconds: 5..300}` | Prazo += `seconds` (não pode estar pausado) |
| `host.set_time` | `{participant_id, multiplier: 0 \| 1 \| 1.5 \| 2}` | Tempo estendido (RF-622). `0` = sem cronômetro |

Erros novos: `already_paused`, `not_paused`, `paused`, `no_timer`, `invalid`, `not_found`.

Frames novos (servidor → cliente):

| Tipo | Público | `data` |
|---|---|---|
| `question.paused` (seq) | todos | `{qi, answers_open_at_ms, deadline_ms, paused: true, paused_at_ms, remaining_ms}` |
| `question.timer` (seq) | todos | `{qi, reason: "resume" \| "extend", answers_open_at_ms, deadline_ms, paused: false}` |
| `participant.time` | só o participante | `{time_multiplier, qi?, deadline_ms?}` (seu prazo próprio na pergunta aberta) |
| `participant.updated` | host | `{participant_id, time_multiplier}` |

`room.snapshot.timer` passa a ser `{answers_open_at_ms, deadline_ms, paused, paused_at_ms?, remaining_ms?}`.
`welcome.me` e `room.snapshot.my` ganham `time_multiplier`. `room.snapshot.participants[]` (host) ganha
`time_multiplier` e `is_bot`.

**Prazo do participante:** `answers_open_at + (deadline − answers_open_at) × max(multiplier, 1)`. Com
`multiplier = 0`, não há prazo. O auto-lock acontece no maior prazo da sala. Se alguém estiver sem
cronômetro, o host fecha a pergunta (ou ela fecha quando todos respondem).
**Pontos:** a velocidade é medida contra a janela do próprio participante (`t / multiplier`). Sem
cronômetro, vale a velocidade neutra (meio da janela). Tempo extra nunca custa pontos.

## 5. Ensaio com bots (RF-513)

`POST /api/live/sessions` aceita `rehearsal: boolean` e `bots: 0..200` (`422 bots_require_rehearsal` sem
ensaio). `LiveSession` ganha `rehearsal: boolean`. Os bots são participantes com `is_bot: true` e
nome `Bot …`. O processo que tem o socket do host faz os bots responderem (~70% de acerto, espalhados
na janela). Eles aparecem no lobby, no ranking e no pódio, mas **não entram em relatórios nem no CSV**.

## 6. Métricas (`GET /api/live/metrics`)

Texto Prometheus, ou `?format=json` (resumo com p50/p95/p99). Acesso: `Authorization: Bearer
LIVE_METRICS_TOKEN`. Sem token configurado, só loopback e nunca em produção. O nginx nunca expõe a rota.
Séries: `live_connections{role}`, `live_rooms_active`, `live_ws_connects_total`, `live_ws_closes_total{code}`,
`live_messages_in_total{type}`, `live_frames_out_total{type}`, `live_broadcast_seconds{type}`,
`live_answer_accept_seconds`, `live_answers_total{status}`, `live_answer_batch_size`,
`live_snapshot_seconds{role}`, `live_event_loop_lag_seconds`, `live_slow_consumer_total`,
`live_ws_rate_limited_total`, `live_cmd_seconds{type}`.

## 7. Configuração nova

| Setting | Padrão |
|---|---|
| `RATE_LIMIT_LIVE_ROOM_REQUESTS` / `_WINDOW_SECONDS` | 6000 / 60 |
| `RATE_LIMIT_LIVE_TOKEN_REQUESTS` / `_WINDOW_SECONDS` | 30 / 60 |
| `RATE_LIMIT_LIVE_CMD_REQUESTS` / `_WINDOW_SECONDS` | 300 / 60 |
| `RATE_LIMIT_LIVE_IP_REQUESTS` / `_WINDOW_SECONDS` | 3000 / 60 |
| `LIVE_INVALID_CODE_LIMIT` / `LIVE_INVALID_CODE_WINDOW_SECONDS` | 60 / 600 |
| `LIVE_SSE_MAX_SECONDS` | 300 |
| `LIVE_METRICS_TOKEN` | vazio |

Migração `0021_live_operations`: `live_session.paused_at`, `live_participant.time_multiplier`
(`CHECK IN (0, 1, 1.5, 2)`) e `live_participant.is_bot`.
