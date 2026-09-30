# Sentinel Arena: contrato do Incremento 2 (IA de criação)

Fonte da verdade entre backend (`backend/app/api/ai.py`, `backend/app/services/ai_authoring/*`) e
frontend (`web/types/api/ai.ts`). Complementa o [contrato do Incremento 1](./CONTRATO-INCREMENTO-1.md) e
implementa a §12 do [plano](./PLANO.md) no escopo do MVP-0.

## 1. Escopo

| Entra | Fica para depois |
|---|---|
| F-IA1 gerar por tópico/objetivo (certificação, domínios, nível, tipos, idioma) | PDF (MVP-1), URL (F2), tradução (F2) |
| F-IA3 gerar a partir de **texto colado** (≤ 20.000 caracteres) | Share-kit "Compartilhar com IA" (MVP-1) |
| F-IA4 melhorar item: `rewrite`, `distractors`, `explain` | Insights pós-sessão por IA (F2) |
| F-IA2 **sorteio determinístico do banco** (`/api/live/bank/sample`, sem IA) | Busca em linguagem natural convertida em filtros |
| F-IA5 sugestão de tempo determinística | Recalibração por p90 observado |
| Pipeline: gerar → validar (regras) → deduplicar → crítico cego → revisão humana obrigatória | pgvector, 3ª chamada de desempate |
| Cotas por créditos com ledger, rate limit, scrub de PII, detecção de injeção, fallback degradado | Orçamento global em US$ com alerta |

## 2. Conceitos

- **Job de IA** (`ai_job`): toda chamada de IA é assíncrona. `POST` cria o job (`202`), o cliente faz poll em
  `GET /api/ai/jobs/{id}` a cada ~1,5 s até `status ∈ {succeeded, failed, degraded}`.
- **Rascunho** (`AiDraftItem`): item proposto pela IA **fora do quiz**. O usuário escolhe quais adicionar
  (`POST /api/ai/jobs/{id}/apply`). Itens aplicados entram no quiz com `source_kind="ai"`,
  `review_state="needs_review"` e `license_scope="own"`: **a publicação continua bloqueada até a revisão**
  (regra já existente do Incremento 1).
- **Issues**: problemas encontrados por regras determinísticas, deduplicação ou pelo crítico. `severity`
  `error` (bloqueia a aplicação do rascunho, salvo `force`) ou `warning`.
- **Flags do crítico**: `key_mismatch` (o crítico, sem ver o gabarito, escolheu outra resposta), `ambiguous`
  (mais de uma resposta defensável ou confiança < 0,7). Itens com essas flags exigem
  `confirm_key: true` na revisão (`POST .../items/{iid}/review`).
- **Créditos**: gerar item = 1 (crítico incluído); melhorar item = 0,5. Cota diária por usuário
  (`AI_DAILY_QUOTA_CREDITS`, padrão 300; admin sem limite). A cota é **reservada ao criar o job** e o
  excedente é estornado se o job falhar. Fail-closed: sem conseguir registrar no ledger, não roda.

## 3. REST

Base `/api/ai`. Exige usuário autenticado **com permissão de hospedar** (mesma política do Incremento 1) e
`AI_AUTHORING_ENABLED=true`. Os `POST` de criação de job têm rate limit próprio (6/min por usuário) e no
máximo 2 jobs em andamento por usuário (`429 ai_too_many_jobs`).

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/capabilities` | — | `AiCapabilities` |
| POST | `/quiz-drafts/generate` | `GenerateIn` | `202 AiJob` |
| POST | `/quiz-drafts/from-source` | `FromSourceIn` | `202 AiJob` |
| POST | `/items/{item_id}/improve` | `ImproveIn` | `202 AiJob` |
| GET | `/jobs/{job_id}` | — | `AiJob` (só o dono) |
| GET | `/jobs?quiz_id=&limit=20` | — | `{"items": [AiJob]}` (sem `result`) |
| POST | `/jobs/{job_id}/apply` | `ApplyIn` | `QuizDetail` (Incremento 1) |
| POST | `/items/suggest-format` | `{item_type, prompt, options?: string[]}` | `{time_limit_s, rationale}` |

Rota nova em `/api/live`:

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/bank/sample` | `BankSampleIn` | `{"question_ids": [...], "coverage": [{"domain", "count"}], "available": n}` |

```ts
AiCapabilities = { enabled: boolean, reason: null | "ai_disabled" | "not_allowed",
  provider: "gemini" | "fake", model: string, critic_enabled: boolean,
  credits: { daily_limit: number | null, used_today: number, remaining: number | null },
  limits: { max_items: 20, source_max_chars: 20000, topic_max_chars: 500 },
  item_types: ["single_choice","multi_choice","true_false","type_answer"],
  certifications: [{ id, label, domains: string[] }] }   // do blueprint oficial

GenerateIn = { quiz_id, topic?: string (≤500), certification?: string, domains?: string[] (≤10),
  level: "Easy" | "Medium" | "Hard" | "mixed", n: 1..20, types: ItemType[] (≥1, dos 4 acima),
  language: "pt-BR" | "en", audience_note?: string (≤200) }        // exige topic OU certification
FromSourceIn = { quiz_id, source_text: string (200..20000), n: 1..20, types, level, language,
  title_hint?: string (≤120) }
ImproveIn = { quiz_id, action: "rewrite" | "distractors" | "explain", instructions?: string (≤300) }
ApplyIn = { quiz_id, expected_version, indexes: number[] (índices em result.items), force?: boolean }
BankSampleIn = { certification?: string, domains?: string[], difficulty?: "Easy"|"Medium"|"Hard",
  n: 1..50, strategy: "coverage" | "random", only_guest_eligible?: boolean, exclude_quiz_id?: string }

AiJob = { id, kind: "generate" | "from_source" | "improve", status: "queued" | "running" |
  "succeeded" | "failed" | "degraded", quiz_id, item_id | null, created_at, started_at | null,
  finished_at | null, progress: { stage: "queued" | "generating" | "validating" | "critic" | "done",
  pct: 0..100 }, credits: number, model | null, error_code | null, error_message | null,
  injection_suspected: boolean, result: AiJobResult | null }

AiJobResult =
  | { type: "drafts", items: AiDraftItem[], summary: { requested, produced, blocked, warnings } }
  | { type: "improvement", item_id, proposal: AiProposal }
  | { type: "degraded", reason: "ai_unavailable", bank_question_ids: string[] }  // cai no modo banco

AiDraftItem = { index, item_type, prompt, options: [{ key, text, correct, why_wrong | null }],
  accepted_answers: string[], explanation, time_limit_s, difficulty | null, domain | null,
  certification | null, issues: AiIssue[], critic: AiCritic | null, applied: boolean, blocked: boolean }
AiIssue = { code, severity: "error" | "warning", message, field | null }
AiCritic = { solved_keys: string[], confidence: number, flags: ("key_mismatch" | "ambiguous" |
  "factual_issue")[], notes: string[] }
AiProposal = { prompt?, options?: [{ key, text, correct }], explanation?, changed: string[] }
```

Aplicar uma proposta de melhoria usa o mesmo `POST /jobs/{id}/apply` com `indexes: [0]`: substitui os
campos alterados no item, marca `review_state="needs_review"` e devolve o `QuizDetail`.

Códigos de erro: `ai_disabled` (404), `ai_quota_exceeded` (429, `details.remaining`), `ai_too_many_jobs`
(429), `ai_job_not_found` (404), `ai_job_not_ready` (409), `ai_draft_blocked` (422, rascunho com issue
`error` sem `force`), `ai_already_applied` (409), `version_conflict` (409), `item_invalid` (422).

`GET /api/live/quizzes/{id}` passa a incluir em cada item `ai: { job_id, model, issues, critic,
requires_key_confirmation } | null`, e `POST .../items/{iid}/review` aceita `{expected_version,
confirm_key?: boolean}` (`422 confirm_key_required` quando o item exige confirmação).

## 4. Regras determinísticas (issues)

| Código | Severidade | Regra |
|---|---|---|
| `schema_invalid` | error | Não respeita o schema (tipos, limites, chaves A–F, `correct_keys ⊆ keys`) |
| `single_needs_one` | error | `single_choice`/`true_false` com ≠ 1 correta |
| `multi_needs_two` | error | `multi_choice` com < 2 corretas ou sem nenhuma errada |
| `duplicate_option` | error | Alternativas iguais após normalização |
| `all_none_of_above` | error | "Todas/nenhuma das anteriores" (pt/en) |
| `negative_stem` | warning | Enunciado negativo sem "NÃO"/"NOT" em caixa alta |
| `length_bias` | warning | Correta > 1,5× a média das erradas, ou a mais longa em > 60% do lote |
| `duplicate_bank` | warning | Similaridade ≥ 0,9 com uma questão do banco (inclui `personal_use`, nunca enviada à IA) |
| `duplicate_batch` | error | Similaridade ≥ 0,9 com outro rascunho do mesmo job |
| `unknown_domain` | warning | Domínio fora do blueprint da certificação |
| `language_mismatch` | warning | Idioma detectado ≠ `language` |
| `obsolete_exam` | warning | Cita versão obsoleta (ex.: SY0-601) |
| `key_mismatch` / `ambiguous` | warning | Flags do crítico; exigem `confirm_key` na revisão |

## 5. Configuração

| Setting | Padrão | Uso |
|---|---|---|
| `AI_AUTHORING_ENABLED` | `false` | Liga `/api/ai/*` (dev: `true`) |
| `AI_PROVIDER` | `gemini` | `gemini` / `fake` (só fora de produção) |
| `AI_AUTHORING_MODEL` | `GEMINI_MODEL` | Modelo de geração |
| `AI_CRITIC_MODEL` | vazio = mesmo modelo | Modelo do crítico (o plano recomenda outro) |
| `AI_CRITIC_ENABLED` | `true` | Liga o crítico cego |
| `AI_AUTHORING_MAX_OUTPUT_TOKENS` / `AI_AUTHORING_TIMEOUT_SECONDS` | 8192 / 90 | Limites |
| `AI_DAILY_QUOTA_CREDITS` | 300 | Cota diária por usuário (0 = sem IA) |
| `AI_MAX_CONCURRENT_JOBS` | 2 | Jobs em andamento por usuário |
| `AI_JOB_RUNNER` | `thread` | `thread` (no processo da API) / `worker` (processo `ai-worker` com `SKIP LOCKED`) |
| `RATE_LIMIT_AI_REQUESTS` / `RATE_LIMIT_AI_WINDOW_SECONDS` | 6 / 60 | Rate limit dos `POST` de criação |
