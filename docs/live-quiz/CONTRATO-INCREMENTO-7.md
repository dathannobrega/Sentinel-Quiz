# Sentinel Arena: contrato do Incremento 7 (sala de espera e 2.000 por sala)

Complementa os contratos dos Incrementos [1](./CONTRATO-INCREMENTO-1.md) a [6](./CONTRATO-INCREMENTO-6.md).
A fonte da verdade é o backend:
- `backend/app/services/live_admission.py`: regras da sala de espera;
- `backend/app/services/live_session.py`: entrada na sala;
- `backend/app/live/{runtime,gateway,protocol}.py`: comandos e eventos;
- testes em `backend/tests/test_live_waiting_room.py`.

## 1. Escopo (E1.20, DC-16, RF-545)

| Entra | Fica para depois |
|---|---|
| Capacidade padrão de **2.000 por sala** (`LIVE_MAX_PARTICIPANTS`) | 5.000 sob flag (F3) |
| **Sala de espera por lotação:** acima do teto a pessoa entra na fila em vez de ser recusada | Notificação push quando a vaga sai |
| **Sala de espera com aprovação** do apresentador (RF-545) | Aprovação por regras (domínio do e-mail etc.) |
| O apresentador aprova, recusa, aprova todos, muda o teto e liga ou desliga a aprovação | |

## 2. Entrada (`POST /api/live/rooms/{code}/join`)

Mesmo corpo de antes. Há duas respostas de sucesso:
- **201**, quem entrou: `{status: "joined", session_id, participant_id, token, expires_at, return_code, display_name, avatar_seed}`.
  O campo `status` é novo.
- **202**, quem vai esperar:

```json
{"status": "waiting", "reason": "approval|capacity", "request_id": "…", "wait_token": "…",
 "session_id": "…", "display_name": "Ana", "avatar_seed": "…",
 "position": 3, "waiting": 40, "retry_after_ms": 3240}
```

| Campo | Regra |
|---|---|
| `reason` | `approval`: a sala exige aprovação (o apresentador entrando na própria sala nunca espera). `capacity`: a sala está cheia |
| `position` | Lugar na fila de lotação (1 = próximo). `null` na aprovação, porque quem decide é o apresentador |
| `wait_token` | Credencial só da espera. Guarde só na aba (`sessionStorage`), como o token do participante |

O nome fica reservado enquanto a pessoa espera; outra pessoa com o mesmo nome recebe `409 name_taken`. Com a fila
cheia (`LIVE_WAITING_ROOM_MAX`, 2.000), volta `409 room_full`. Com a sala trancada, volta `423 room_locked` (não
há fila).

Quem já está esperando e entra de novo com a mesma conta recebe um `wait_token` novo (outra aba ou aparelho).

`GET /api/live/rooms/{code}` passa a trazer `accepting_joins` (só depende do trancamento), `full` e
`requires_approval`.

## 3. Espera (`/api/live/queue/{request_id}`, `Authorization: Bearer <wait_token>`)

| Método | Resposta |
|---|---|
| GET | Ainda esperando: o mesmo formato do 202 (sem `wait_token`), com `position` e `retry_after_ms` atualizados. Admitido: `{status: "admitted", request_id, session_id, join: <resultado do join 201>}`. Outros fins: `{status: "rejected" \| "expired" \| "withdrawn"}` |
| DELETE | Sair da fila → `{status: "withdrawn"}` |

`403 invalid_wait_token` quando o ticket não confere.

Regras para o celular:
- Faça o próximo GET só depois de `retry_after_ms` (de 3 s a 15 s, conforme o tamanho da fila), com um pouco de
  jitter. Faça o poll só com a aba visível; ao voltar para a aba, consulte logo.
- Quem para de consultar por `LIVE_WAITING_STALE_SECONDS` (45 s) perde a vez quando as vagas são distribuídas
  (`expired`): a vaga vai para quem ainda está ali.
- **Admitido:** o `join` é idêntico ao da entrada normal. Mostre o código de retorno, que só vem na **primeira**
  entrega, e siga para a sala como sempre. Cada GET depois disso emite um token novo, e o da aba anterior deixa de
  valer.
- **Fim da sala** durante a espera: `expired`.

## 4. Apresentador

`room.snapshot` (host) ganha `waiting_room`:

```json
{"require_approval": true, "max_participants": 2000, "platform_max": 2000,
 "approval_count": 3, "capacity_count": 0,
 "approval": [{"request_id": "…", "display_name": "Ana", "avatar_seed": "…", "signed_in": false,
               "created_at": "…", "connected": true}]}
```

- `approval` traz os 100 mais antigos.
- `connected: false` indica que o celular parou de consultar.
- Quando a fila muda, o host recebe `waiting_room.update` com o mesmo bloco, agrupado com o `lobby.update` (até
  2 por segundo).

Comandos novos (WebSocket ou `/api/live/cmd`):

| Comando | Dados | Efeito |
|---|---|---|
| `host.admit` | `{request_ids: [...]}` ou `{all: true}` | Admite quem espera aprovação. Sem vaga, a pessoa vai para a fila de lotação mantendo a ordem de chegada |
| `host.reject` | `{request_id}` | Recusa (`error not_found` se ela já saiu) |
| `host.set_capacity` | `{max_participants}` | Muda o teto da sala, até `platform_max`. Subir o teto admite a fila na ordem |
| `host.set_approval` | `{required}` | Liga ou desliga a aprovação. Desligar admite todos que esperavam aprovação, se houver vaga |

Depois de cada comando o host recebe um `room.snapshot` novo. Expulsar alguém (`host.kick`) e a exclusão de dados
liberam vagas, que vão automaticamente para a fila.

Criar sessão (`POST /api/live/sessions`) aceita `require_approval: true`. A sessão serializada traz
`require_approval`.

## 5. Capacidade

- O teto padrão por sala é 2.000, e `max_participants` pode ser menor.
- O teto é **exato** mesmo com joins simultâneos: perto dele, a decisão usa trava de linha da sala.
- No desafio self-paced o teto continua sendo limite rígido (`409 room_full`), sem fila.

## 6. Migração `0025_live_waiting_room`

`live_session.require_approval` e a tabela `live_join_request`. Quem espera não é participante: contagens,
ranking, relatórios e o lobby não o veem.

## 7. Telas (frontend)

| Tela | Conteúdo |
|---|---|
| **Celular: sala de espera** | Depois do "Entrar", o 202 leva a uma tela de espera com o nome e o avatar. A mensagem muda conforme o motivo: "Aguardando o apresentador liberar a entrada" ou "A sala está cheia. Você é o nº {position} da fila" (com o total esperando). Tem animação discreta, "Sair da fila" e poll conforme `retry_after_ms`. Admitido, mostra o código de retorno (só na primeira entrega) e segue o fluxo normal. Recusado ou expirado, mostra a mensagem certa com "Tentar de novo". Acessível: anúncio `aria-live` quando a posição muda e quando entra |
| **Apresentador** | Painel "Sala de espera" na visão do apresentador e no palco com controles. Mostra a lista de quem aguarda aprovação (nome, conectado ou não, há quanto tempo) com "Aprovar" e "Recusar", "Aprovar todos", o contador da fila de lotação, o controle do teto e o liga/desliga da aprovação. O botão "Sala de espera" na barra do palco mostra quantos aguardam. O telão (display) não recebe nada da fila |
| **Criar sessão** | Opção "Aprovar a entrada de cada pessoa (sala de espera)" no diálogo de apresentar |
