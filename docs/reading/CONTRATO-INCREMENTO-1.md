# Sentinel Reader: contrato do Incremento 1 (ouvir, ler junto e shadowing)

> Complementa o [plano](./PLANO.md). A fonte da verdade é o código:
> - `backend/app/api/reading.py` (API pública `/api/reading`), `backend/app/services/reading.py` (biblioteca, progresso, tentativas), `backend/app/services/speech_client.py` (cliente do serviço de voz);
> - `speech/` (serviço de voz: TTS com timestamps por palavra e avaliação de leitura);
> - `web/features/reading/` e `web/app/read/`;
> - testes em `backend/tests/test_reading_api.py`, `speech/tests/` e `web/features/reading/**/*.test.ts(x)`.

## 1. Escopo (Incremento 1)

| Entra | Fica para depois |
|---|---|
| **Biblioteca**: os livros já convertidos em `material/json` (corpo normalizado de `material_corpus.py`), por capítulo e seção, com "continuar de onde parei" | Importar livros novos pela UI; textos próprios |
| **Ouvir + ler junto (read-along)**: TTS neural (Kokoro-82M) por parágrafo, palavra destacada em sincronia, clique na palavra para pular, velocidade e voz, avanço automático | Vozes clonadas; TTS expressivo (Chatterbox/Orpheus) |
| **Shadowing com correção**: gravar a leitura de um parágrafo, receber cada palavra marcada (ok / fraca / pronunciada errado / omitida / extra), o que o modelo ouviu, IPA esperado × ouvido, notas de precisão, completude, fluência e geral, WPM | Nota por fonema (GOP) com modelo acústico de fonemas; feedback de entonação |
| **Fallback no navegador**: `speechSynthesis` com destaque por `onboundary` quando o serviço de voz está fora | Reconhecimento de voz do navegador (SpeechRecognition manda áudio para a nuvem: fora por privacidade) |
| **Progresso e histórico**: posição por livro, palavras lidas, segundos ouvidos, tentativas por parágrafo, painel com estatísticas | SRS de palavras difíceis; metas e streak de leitura |
| **Serviço de voz separado** (`speech`), só na rede interna, sem porta publicada, com cache de áudio | GPU; fila distribuída |

Idioma do conteúdo: inglês (os livros). UI em pt-BR e en-US (paridade de chaves obrigatória).

## 2. Nomes e caminhos

| | |
|---|---|
| Nome de produto (UI) | **Leitura** (pt-BR) / **Reading** (en-US). Nome interno: Sentinel Reader |
| Namespace técnico | `reading` (`/api/reading`, `web/features/reading`, tabelas `reading_*`) |
| Rotas web | `/read` (biblioteca), `/read/[book]` (capítulos e seções), `/read/s/[sectionId]` (leitor) |
| Serviço de voz | `speech/` → imagem `sentinel-quiz-speech`, porta interna **8100**, rede interna `speech` (api ↔ speech) |

## 3. Pré-requisitos e permissões

- Todas as rotas exigem **usuário autenticado** (os livros são licenciados; mesma regra de `/api/materials/*`). Sem `X-Client-Key`.
- `READING_ENABLED` (default `true`): com `false`, `GET /api/reading/capabilities` responde `{"enabled": false}` e as demais rotas 404 `reading_disabled`.
- Sem `material/json` montado: `capabilities.books_available = false`; a biblioteca vem vazia.
- Sem serviço de voz (`SPEECH_SERVICE_URL` vazio ou fora do ar): `tts.available = false` e `assess.available = false` com `reason`; o leitor usa `speechSynthesis` e o shadowing fica desativado com aviso. A API consulta `GET {SPEECH_SERVICE_URL}/healthz` e guarda o resultado por 30 s.
- Cabeçalho `Permissions-Policy` passa a `microphone=(self)` (em `web/next.config.mjs` e `docker/nginx/api-security-headers.conf`, sempre iguais). CSP ganha `media-src 'self' blob: {apiOrigin}` (áudio tocado a partir de `URL.createObjectURL`).
- O áudio gravado **nunca é persistido**: a API o repassa ao serviço de voz e guarda só o resultado (palavras, notas). O serviço de voz guarda em cache apenas o áudio **sintetizado** (TTS), nunca a gravação.

## 4. API pública (`/api/reading`, JSON, envelope de erro padrão `{code, message}`)

### 4.1 `GET /capabilities`

```json
{"enabled": true, "books_available": true,
 "tts": {"available": true, "reason": null, "engine": "kokoro", "model": "hexgrad/Kokoro-82M",
         "default_voice": "af_heart",
         "voices": [{"id": "af_heart", "label": "Heart", "lang": "en-US", "gender": "female"}],
         "speeds": [0.75, 0.9, 1.0, 1.1, 1.25]},
 "assess": {"available": true, "reason": null, "engine": "faster-whisper", "model": "small.en",
            "max_audio_bytes": 8000000, "max_seconds": 90},
 "quota": {"daily_limit": 400, "used_today": 3, "remaining": 397}}
```

`reason`: `speech_unavailable` (serviço fora), `speech_warming` (modelos carregando), `disabled` (engine desligada no serviço).

### 4.2 `GET /library`

```json
{"books": [{"slug": "comptia_security_plus_sy0_701", "title": "CompTIA Security+ Study Guide Exam SY0-701",
            "certification": "CompTIA Security+ (SY0-701)", "words": 543467, "minutes": 3623, "sections": 812,
            "chapters": [{"file": "c01", "index": 1, "title": "Today's Security Professional", "sections": 41, "words": 21000, "minutes": 140}],
            "progress": {"section_id": "comptia_security_plus_sy0_701:c04:head-3-30", "section_title": "Smishing",
                         "part_id": "...", "block_index": 2, "percent": 12.5, "mode": "listen",
                         "words_read": 5300, "seconds_listened": 2100, "updated_at": "2026-10-12T10:00:00Z"}}]}
```

- Só seções **legíveis**: `kind ∈ {teach, summary}` com ≥ 20 palavras (`front`, `review`, `answers` ficam de fora).
- `minutes` = palavras / 150, arredondado para cima. `percent` = posição da seção atual na ordem de leitura do livro × 100.
- Ordem: livros por certificação e título; capítulos por `index`.

### 4.3 `GET /books/{slug}/chapters/{chapter_file}`

```json
{"book": {"slug": "...", "title": "...", "certification": "..."},
 "chapter": {"file": "c04", "index": 4, "title": "Social Engineering and Password Attacks", "words": 15400, "minutes": 103},
 "sections": [{"id": "book:c04:head-3-1", "title": "Social Engineering", "level": 1, "kind": "teach", "words": 980, "minutes": 7,
               "parent_id": null, "completed": false}]}
```

Ordem do documento; `level` serve para indentar. `completed` = `true` quando a posição do progresso do usuário já passou dessa seção. 404 `book_not_found` / `chapter_not_found`.

### 4.4 `GET /sections/{section_id}`

Mesmo corpo de `GET /api/materials/sections/{id}` (`StudySectionDetailOut`: `parts[].blocks[]` com `text` e `label`, `parent`, `previous`, `next`, `truncated`, `practice_questions`), mais:

```json
{"book_slug": "...", "chapter_file": "c04", "chapter_index": 4,
 "position": {"index": 57, "total": 812},
 "progress": {"part_id": "...", "block_index": 2, "mode": "listen", "updated_at": "..."} | null}
```

`previous`/`next` seguem a ordem de leitura do livro pulando descendentes (os descendentes já aparecem em `parts`). Um **bloco** é identificado por `(part_id, block_index)` e é a unidade de TTS e de shadowing. 404 `section_not_found`.

### 4.5 `POST /sections/{section_id}/tts`

Corpo: `{"part_id": "...", "block_index": 0, "voice": "af_heart", "speed": 1.0}` (`voice` e `speed` opcionais; `speed` ∈ [0.5, 1.5]).
O texto **nunca** vem do cliente: a API resolve o bloco no corpus (evita TTS de texto arbitrário).

```json
{"audio_id": "3f2a…64 hex", "audio_url": "/api/reading/audio/3f2a…", "content_type": "audio/mpeg",
 "duration_seconds": 31.4, "voice": "af_heart", "speed": 1.0, "engine": "kokoro", "cached": true,
 "text": "Security awareness training…",
 "words": [{"text": "Security", "start": 0.08, "end": 0.52, "char_start": 0, "char_end": 8}]}
```

`char_start/char_end` indexam `text` (o mesmo texto do bloco), para o destaque por offset. Erros: 404 `block_not_found`, 400 `voice_invalid`, 503 `speech_unavailable` / `speech_warming`, 504 `speech_timeout`.

### 4.6 `GET /audio/{audio_id}`

`audio_id` = `^[0-9a-f]{64}$`. Repassa o áudio do serviço de voz (`audio/mpeg` ou `audio/wav`) com `Cache-Control: private, max-age=86400`. 404 `audio_not_found` quando o cache expirou (o cliente refaz o `POST …/tts`).

### 4.7 `POST /sections/{section_id}/assess` (multipart/form-data)

Campos: `audio` (arquivo; `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/wav`, `video/webm`), `part_id`, `block_index`.
Limites: `SPEECH_MAX_AUDIO_BYTES` (8 MB) → 413 `audio_too_large`; tipo não aceito → 415 `audio_unsupported`; quota diária por usuário (`READING_DAILY_ASSESS_QUOTA`, 400) → 429 `reading_quota_exceeded`.

```json
{"attempt_id": "uuid", "created_at": "...", "engine": "faster-whisper", "model": "small.en",
 "duration_seconds": 14.2, "speech_seconds": 12.0, "transcript": "security awareness training is…",
 "text": "Security awareness training is…",
 "words": [{"index": 0, "text": "Security", "char_start": 0, "char_end": 8, "status": "ok",
            "heard": "security", "confidence": 0.93, "start": 0.10, "end": 0.52,
            "expected_ipa": "sɪkjˈʊɹəTi", "heard_ipa": null}],
 "extras": [{"text": "um", "after_index": 3, "start": 2.1, "end": 2.3}],
 "scores": {"accuracy": 0.91, "completeness": 0.97, "fluency": 0.80, "overall": 0.89},
 "metrics": {"reference_words": 48, "ok": 40, "weak": 3, "mispronounced": 3, "missed": 2, "extra": 1,
             "wpm": 128.0, "long_pauses": 1, "target_wpm": [120, 170]},
 "tips": [{"code": "phoneme_confusion", "expected": "θ", "heard": "t", "examples": ["think", "threat"]}],
 "best_overall": 0.92, "attempts_for_block": 3}
```

| `status` | Regra |
|---|---|
| `ok` | palavra alinhada ao que foi ouvido (igual após normalização) e confiança ≥ 0,6 |
| `weak` | alinhada, mas confiança < 0,6 (o modelo hesitou) |
| `mispronounced` | substituída por outra palavra (ou parecida: similaridade ≥ 0,5) — `heard` traz o que foi ouvido |
| `missed` | omitida |

`extras` são inserções (palavras ditas que não estão no texto), ancoradas após `after_index` (−1 = antes da primeira).
Notas em [0, 1]: `accuracy` = (ok + 0,5·weak) / referência; `completeness` = (referência − missed) / referência; `fluency` combina WPM dentro da faixa alvo (120–170) e penaliza pausas longas (> 0,8 s) e extras; `overall` = 0,6·accuracy + 0,2·completeness + 0,2·fluency.

### 4.8 Progresso e histórico

| Método | Corpo / resposta |
|---|---|
| `PUT /progress` | corpo `{"book_slug", "section_id", "part_id", "block_index", "mode": "listen|read|shadow", "words_read": 90, "seconds_listened": 31}` → a linha de progresso (upsert por `(user, book)`; `words_read` e `seconds_listened` são **incrementos**, somados ao total) |
| `GET /progress` | `{"items": [progress…]}` (um por livro, mais recente primeiro) |
| `GET /sections/{id}/attempts?limit=20` | `{"attempts": [{"id", "part_id", "block_index", "overall", "accuracy", "completeness", "fluency", "wpm", "created_at"}]}` do usuário, mais recentes primeiro |
| `GET /stats` | `{"attempts": 57, "avg_overall": 0.82, "best_overall": 0.97, "words_read": 12000, "seconds_listened": 5400, "active_days_30": 9, "recent": [{"date": "2026-10-12", "attempts": 4, "avg_overall": 0.85}]}` (últimos 7 dias, inclusive dias sem tentativa) |

### 4.9 Rate limit e quotas

- Bucket novo `reading` por IP para `POST /api/reading/...`: `RATE_LIMIT_READING_REQUESTS` (60) por `RATE_LIMIT_READING_WINDOW_SECONDS` (60).
- Quota diária de avaliações por usuário: `READING_DAILY_ASSESS_QUOTA` (400), contada em `reading_attempt` (dia UTC).
- `client_max_body_size 10m` e `proxy_read_timeout 120s` na location `/api/reading/` do nginx (o ASR pode levar alguns segundos).

## 5. Serviço de voz (`speech/`, interno)

FastAPI, Python 3.12, CPU. Só a API o alcança (rede `speech`). Autenticação opcional por `SPEECH_API_TOKEN` (`Authorization: Bearer …`; vazio = sem auth, aceitável porque a rede é interna).

### 5.1 Endpoints

| Rota | Entrada | Saída |
|---|---|---|
| `GET /healthz` | — | `{"status": "ok|warming|degraded", "tts": {"engine", "model", "ready", "voices": [{"id","label","lang","gender"}], "default_voice"}, "asr": {"engine", "model", "ready"}}` (200 sempre; `ready=false` enquanto carrega) |
| `POST /v1/tts` | `{"text" (≤ 2000 chars), "voice", "speed" (0.5–1.5), "lang": "en-us|en-gb"}` | `{"audio_id", "content_type", "duration_seconds", "sample_rate", "cached", "engine", "model", "voice", "speed", "words": [{"text","start","end","char_start","char_end"}]}` |
| `GET /v1/audio/{audio_id}` | — | bytes (`audio/mpeg` quando há ffmpeg, senão `audio/wav`), `Cache-Control: private, max-age=86400`; 404 `audio_not_found` |
| `POST /v1/assess` | multipart: `audio` (arquivo), `reference_text` (≤ 2000), `lang` (`en`) | corpo de §4.7 sem `attempt_id`/`created_at`/`best_overall`/`attempts_for_block` |

- `audio_id` = sha256(engine, model, voice, speed, lang, text) em hex: o mesmo pedido nunca sintetiza duas vezes. Cache em disco (`SPEECH_CACHE_DIR`), LRU por tamanho (`SPEECH_CACHE_MAX_MB`, 2048), com o JSON de palavras ao lado do áudio.
- `words` do TTS: tokens do Kokoro (`start_ts`/`end_ts` por token, misaki) com ≥ 1 letra ou dígito; `char_start/char_end` são offsets no `text` recebido (o serviço mapeia os tokens para o texto original); tokens sem timestamp são interpolados entre vizinhos; `end` do último = duração.
- Erros: `{code, message}`; 400 `text_required` / `text_too_long` / `audio_invalid`, 413 `audio_too_large`, 503 `model_not_ready` / `engine_disabled` / `busy` (com `Retry-After`).
- Inferência em thread pool com semáforos (`SPEECH_MAX_CONCURRENCY`, 2 por engine); espera até 60 s e então 503 `busy`.

### 5.2 Engines

| Papel | Engine padrão | Alternativas | Observações |
|---|---|---|---|
| TTS | **Kokoro-82M** (`hexgrad/Kokoro-82M`, Apache 2.0, `kokoro` 0.9.x + `misaki[en]`, torch CPU) | `none`, `fake` (testes) | vozes `af_heart, af_bella, af_nicole, am_michael, am_adam, bf_emma, bm_george`; `espeak-ng` instalado para palavras fora do dicionário |
| ASR | **faster-whisper** (`small.en`, `int8`, CTranslate2) | `mlx-whisper` (Mac nativo, Apple Silicon), `none`, `fake` | `word_timestamps=True`, `beam_size=5`, `temperature=0`, `condition_on_previous_text=False`, **sem** `initial_prompt` com o texto de referência (evitaria o viés de "autocorrigir" a pronúncia) |
| G2P (IPA) | misaki `en` (já dependência do Kokoro) | — | `expected_ipa` do texto de referência e `heard_ipa` do que foi ouvido, só para palavras `mispronounced`/`weak` |

Alinhamento palavra a palavra: Levenshtein com custo de substituição por similaridade (rapidfuzz), sobre tokens normalizados (minúsculas, sem pontuação, números por extenso simples, apóstrofos preservados). Pausas longas = intervalos > 0,8 s entre palavras ouvidas consecutivas.

### 5.3 Configuração (env)

| Variável | Default | Descrição |
|---|---|---|
| `SPEECH_HOST` / `SPEECH_PORT` | `0.0.0.0` / `8100` | bind |
| `SPEECH_TTS_ENGINE` / `SPEECH_TTS_MODEL` | `kokoro` / `hexgrad/Kokoro-82M` | `kokoro|fake|none` |
| `SPEECH_TTS_DEFAULT_VOICE` / `SPEECH_TTS_VOICES` | `af_heart` / lista acima | vozes oferecidas |
| `SPEECH_ASR_ENGINE` / `SPEECH_ASR_MODEL` | `faster-whisper` / `small.en` | `faster-whisper|mlx-whisper|fake|none`; para MLX ex.: `mlx-community/whisper-small.en-mlx` |
| `SPEECH_ASR_COMPUTE_TYPE` / `SPEECH_ASR_THREADS` | `int8` / `4` | CTranslate2 |
| `SPEECH_AUDIO_FORMAT` | `mp3` | `mp3` (ffmpeg, 64 kb/s mono) ou `wav` |
| `SPEECH_CACHE_DIR` / `SPEECH_CACHE_MAX_MB` | `/var/cache/speech` / `2048` | cache do áudio sintetizado |
| `SPEECH_MAX_AUDIO_BYTES` / `SPEECH_MAX_TEXT_CHARS` | `8000000` / `2000` | limites |
| `SPEECH_MAX_CONCURRENCY` | `2` | inferências simultâneas por engine |
| `SPEECH_PRELOAD` | `true` | carrega os modelos no start (senão, no primeiro uso) |
| `SPEECH_API_TOKEN` | vazio | token compartilhado com a API |
| `HF_HOME` | `/var/cache/speech/hf` | cache dos modelos (volume `speech_models`) |

### 5.4 Execução

- **Docker** (compose): serviço `speech` (`speech/Dockerfile`), volumes `speech_models` e `speech_cache`, limites `APP_SPEECH_CPUS` (4) / `APP_SPEECH_MEMORY` (4g). A API recebe `APP_SPEECH_SERVICE_URL=http://speech:8100`.
- **Nativo no Mac (M1 Pro)**: `cd speech && uv sync && uv run speech-server` (ASR com `SPEECH_ASR_ENGINE=mlx-whisper` opcional); `brew install espeak-ng ffmpeg`. A API local usa `SPEECH_SERVICE_URL=http://127.0.0.1:8100`.

## 6. Modelo de dados (migração `0026_reading`)

```
reading_progress
  id String(36) PK · user_id FK users ON DELETE CASCADE NOT NULL
  book_slug String(128) NOT NULL · section_id String(256) NOT NULL · part_id String(256) NOT NULL
  block_index Integer NOT NULL default 0 · mode String(16) NOT NULL default 'listen'  (check: listen|read|shadow)
  words_read Integer NOT NULL default 0 · seconds_listened Integer NOT NULL default 0
  created_at / updated_at DateTime(tz) NOT NULL
  UNIQUE (user_id, book_slug) uq_reading_progress_user_book · INDEX ix_reading_progress_user_id

reading_attempt
  id String(36) PK · user_id FK users ON DELETE CASCADE NOT NULL (index)
  book_slug String(128) · section_id String(256) NOT NULL · part_id String(256) NOT NULL · block_index Integer NOT NULL
  reference_words Integer NOT NULL · accuracy / completeness / fluency / overall Float NOT NULL
  wpm Float NULL · duration_seconds Float NULL · engine String(32) · model String(64)
  result_json Text NOT NULL (words, extras, tips, metrics, transcript; sem áudio)
  created_at DateTime(tz) NOT NULL
  INDEX ix_reading_attempt_user_created (user_id, created_at) · INDEX ix_reading_attempt_section (user_id, section_id)
```

## 7. Frontend (`web/`)

- `app/read/page.tsx` (biblioteca), `app/read/[book]/page.tsx`, `app/read/s/[sectionId]/page.tsx` (`sectionId` em `encodeURIComponent`). `/read` entra em `GUARDED_PREFIXES` (`proxy.ts`).
- `features/reading/`: `hooks.ts` (react-query; chaves em `lib/query/keys.ts`: `readingCapabilities`, `readingLibrary`, `readingChapter(slug, file)`, `readingSection(id)`, `readingAttempts(id)`, `readingStats`, `readingProgress`), `lib/tokenize.ts` (tokens de exibição com offsets; casar `words` por `char_start`), `lib/recorder.ts` (MediaRecorder: `audio/webm;codecs=opus` → `audio/mp4` → `audio/ogg;codecs=opus`, 32 kb/s, teto 90 s), `lib/web-speech.ts` (fallback `speechSynthesis` com `onboundary`), `lib/use-audio-player.ts` (HTMLAudioElement + `requestAnimationFrame`, `playbackRate`, palavra atual por tempo), componentes `library.tsx`, `book-chapters.tsx`, `reader.tsx`, `read-along-block.tsx`, `player-bar.tsx`, `shadow-panel.tsx`, `assessment-result.tsx`, `reading-stats.tsx`.
- Tipos em `types/api/reading.ts` (exportado no barrel). Mensagens em `lib/i18n/locales/{pt-br,en-us}/reading.ts` (chave `reading`), incluídas nos índices. Rótulo de navegação `common.labels.reading` ("Leitura" / "Reading"); item no menu "Estudar" (desktop) com `BookIcon`.
- Leitor: cabeçalho (livro › capítulo › seção), texto em blocos com palavras em `<span data-word>`; bloco ativo com borda; palavra atual destacada (`bg-primary-soft`); clique na palavra → `seek(word.start)`; barra fixa inferior (play/pause, −/+ bloco, velocidade, voz, auto-avançar, modo Ouvir/Shadowing); atalhos: espaço (play/pause), `←`/`→` (bloco), `R` (gravar no shadowing). Pré-busca do TTS do próximo bloco enquanto o atual toca. Fim da seção com auto-avançar → navega para `next`.
- Shadowing: botão gravar/parar (com tempo e teto), envio, resultado com legenda das cores, notas (`Meter kind="score"`), WPM, `heard` e IPA em tooltip/linha abaixo da palavra, botão "ouvir o modelo" (toca o trecho `start–end` do TTS do bloco), "tentar de novo", histórico de tentativas do bloco. Sem microfone/permissão negada → mensagem clara.
- Progresso: `PUT /progress` com debounce de 2 s ao mudar de bloco e no `pagehide` (`keepalive`), somando `words_read` (bloco concluído) e `seconds_listened`.
- Acessibilidade: controles com `aria-label`, destaque não só por cor (sublinhado na palavra atual; ícone/texto nos status), `prefers-reduced-motion` respeitado, foco visível. Layout de celular com a barra inferior acima da tab bar (`pb-[env(safe-area-inset-bottom)]`).

## 8. Variáveis novas da API

| Variável | Default | Descrição |
|---|---|---|
| `READING_ENABLED` | `true` | liga a feature |
| `SPEECH_SERVICE_URL` | vazio | base do serviço de voz (`http://speech:8100`); vazio = sem TTS neural e sem shadowing |
| `SPEECH_API_TOKEN` | vazio | mesmo valor do serviço |
| `SPEECH_TIMEOUT_SECONDS` | `60` | timeout das chamadas TTS/assess |
| `SPEECH_MAX_AUDIO_BYTES` | `8000000` | teto do upload de gravação |
| `READING_DAILY_ASSESS_QUOTA` | `400` | avaliações por usuário/dia |
| `RATE_LIMIT_READING_REQUESTS` / `RATE_LIMIT_READING_WINDOW_SECONDS` | `60` / `60` | bucket `reading` |
