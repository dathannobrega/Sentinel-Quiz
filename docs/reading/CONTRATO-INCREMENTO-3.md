# Sentinel Reader: contrato do Incremento 3 (áudio por frase, antecipação, aquecimento e "ouvir e repetir")

> Complementa os contratos [1](./CONTRATO-INCREMENTO-1.md) e [2](./CONTRATO-INCREMENTO-2.md). Motivação: numa VM de 3 a 4 vCPUs (Xeon E5-2682 v4), o primeiro parágrafo leva 15 a 25 s para começar a tocar e a avaliação de 30 s de leitura leva 15 a 20 s. Este incremento ataca a **espera inicial**, as **lacunas** entre parágrafos e seções, a **configuração automática** para máquinas pequenas e a **continuidade do treino de fala**.
> Fonte da verdade: `speech/`, `backend/app/{api,services}/reading*.py`, `web/features/reading/`, testes de cada camada.

## 1. Escopo

| Entra | Fica para depois |
|---|---|
| **Frase como unidade de síntese e de cache** no `speech`; `POST /v1/tts/stream` devolve uma frase por vez (NDJSON) e o cliente toca a primeira assim que ela existe | Streaming de áudio dentro da própria frase (chunks de PCM) |
| **Fonemas em paralelo** com o Whisper quando há núcleos sobrando (`SPEECH_PARALLEL_PHONEMES=auto`) | GPU |
| **Threads e concorrência automáticas** a partir dos núcleos que o container realmente tem (cgroup) | — |
| **Prioridade**: pedidos de aquecimento são "low" e nunca atrasam um pedido do leitor | Fila distribuída |
| **Antecipação no cliente**: próximo parágrafo (áudio incluído) e o primeiro parágrafo da próxima seção | — |
| **Aquecimento no servidor**: `POST /sections/{id}/warm` sintetiza os próximos parágrafos em segundo plano | Aquecer livros inteiros à noite (cron) |
| **Velocidade 0,5× e 0,6×** | — |
| **Idioma do livro** detectado; voz neural e avaliação só para inglês; voz do navegador no idioma certo | Livros em pt-BR com Kokoro `p*` (Inc. 5) |
| **"Ouvir e repetir"**: modo mãos livres frase a frase, com parada por silêncio | Feedback em tempo real durante a leitura (exige ASR em streaming; sem orçamento de CPU para isso) |
| Cache de áudio: 8 GB por padrão; documentação de disco | Calibração com gravações reais (precisa de dados; ferramenta já existe) |

## 2. Serviço de voz (`speech/`)

### 2.1 Frases
- Divisão de frases com a **mesma regra do corpus** (`(?<=[.!?:])\s+(?=[A-Z0-9“"(•])`), reproduzida em `textnorm.split_sentences(text) -> [(char_start, char_end)]`. Frases com menos de 3 palavras são juntadas à vizinha (evita pedaços de 0,3 s). Nenhuma frase passa de 400 caracteres (acima disso, quebra na vírgula ou no espaço mais próximo do meio).
- Cada frase é sintetizada e cacheada como um `audio_id` próprio (`audio_id_for(engine, model, voice, speed, lang, sentence_text)`); o bloco inteiro continua existindo como `audio_id` próprio, formado pela **concatenação do PCM** das frases (um único encode). Um pedido de bloco cujas frases já estão em cache não sintetiza nada.
- `words` de cada frase trazem `char_start/char_end` **relativos ao texto do bloco** e `start/end` relativos ao áudio da frase.

### 2.2 `POST /v1/tts/stream`
Corpo igual ao de `/v1/tts`. Resposta `application/x-ndjson`, uma linha por evento, enviada assim que cada frase fica pronta:

```json
{"type":"meta","block_audio_id":"…","sentences":4,"engine":"kokoro","model":"…","voice":"af_heart","speed":1.0,"lang":"en-us","content_type":"audio/mpeg"}
{"type":"segment","index":0,"audio_id":"…","char_start":0,"char_end":118,"duration_seconds":6.21,"cached":true,"words":[{"text":"When","start":0.08,"end":0.31,"char_start":0,"char_end":4}]}
{"type":"segment","index":1,…}
{"type":"done","duration_seconds":31.4}
```

- Erro depois de `meta`: linha `{"type":"error","code":"tts_failed","message":"…"}` e fim do corpo (status já era 200). Erro antes: resposta JSON normal com o status (400/503).
- O bloco inteiro (`/v1/tts`) **não** é gerado pelo stream; quem precisar dele (download offline) chama `/v1/tts`, que reaproveita as frases cacheadas.
- Cabeçalhos: `Cache-Control: no-store`, `X-Accel-Buffering: no`.

### 2.3 Prioridade e concorrência
- Cabeçalho `X-Speech-Priority: low|normal` (default `normal`). O limitador por engine vira uma fila com duas classes: um pedido `low` só pega um slot quando **nenhum** `normal` está esperando; `normal` nunca espera por `low` além do slot já em uso. `503 busy` para `low` após `SPEECH_LOW_PRIORITY_WAIT_SECONDS` (default 20) sem slot.
- Métricas: `speech_requests_total{route,status,priority}` e `speech_queue_wait_seconds{engine,priority}` (histograma).

### 2.4 Threads e concorrência automáticas
- `effective_cpus()` = quota do cgroup v2 (`/sys/fs/cgroup/cpu.max`, arredondada para cima) ou v1 (`cpu.cfs_quota_us/cpu.cfs_period_us`), senão `len(os.sched_getaffinity(0))`, senão `os.cpu_count()`.
- `SPEECH_ASR_THREADS`, `SPEECH_TORCH_THREADS`, `SPEECH_PHONEME_THREADS`: default **`0` = automático** = `max(1, effective_cpus)`; cada engine usa esse valor, e a concorrência garante que só uma inferência pesada roda por vez em máquinas pequenas.
- `SPEECH_MAX_CONCURRENCY`: default **`0` = automático** = `1` se `effective_cpus < 6`, senão `2`.
- `SPEECH_PARALLEL_PHONEMES`: `auto` (default) = paralelo só se `effective_cpus >= 6`; `on`; `off`. Em paralelo, o forward do wav2vec2 roda numa thread enquanto o Whisper transcreve (os dois só precisam do PCM); o alinhamento fonético continua depois do Whisper. Em `auto` com poucos núcleos, as threads do wav2vec2 ficam em `max(1, effective_cpus // 2)` quando paralelo está ligado à força.
- `/healthz` ganha `"runtime": {"effective_cpus": 3, "threads": {"asr": 3, "torch": 3, "phoneme": 3}, "max_concurrency": 1, "parallel_phonemes": false}`.

### 2.5 Compatibilidade
`/v1/tts`, `/v1/audio/{id}`, `/v1/assess`, `/v1/g2p` e `/metrics` continuam iguais. `SPEECH_CACHE_MAX_MB` default passa a `8192`.

## 3. API pública (`/api/reading`)

### 3.1 Stream
`GET /sections/{id}/tts/stream?part_id=…&block_index=…&voice=…&speed=…` → repasse do NDJSON do `speech` (`StreamingResponse`, `Cache-Control: no-store`), com `audio_url` acrescentado a cada `segment` (`/api/reading/audio/{audio_id}`) e `text` do bloco na linha `meta`. Mesmas validações do `POST …/tts` (bloco do corpus, voz, velocidade, idioma do livro). Erros antes do primeiro byte: JSON normal (404 `block_not_found`, 400 `voice_invalid`, 409 `language_unsupported`, 503 `speech_unavailable`/`speech_warming`). Conta no bucket `reading` como os POSTs.

### 3.2 Aquecimento
`POST /sections/{id}/warm` corpo `{"part_id","block_index","voice"?,"speed"?}` → `202 {"queued": 5, "skipped": 1}`.
- Enfileira, com prioridade `low`, as frases dos próximos `READING_WARM_BLOCKS_AHEAD` (default 6) blocos **a partir** do bloco informado (inclusive os das subseções exibidas) e o primeiro bloco da próxima seção na ordem de leitura.
- Executor: thread única por processo da API (`READING_WARM_WORKERS`, default 1), fila limitada a `READING_WARM_QUEUE_MAX` (default 200) com deduplicação por `(section, part, block, voice, speed)`; pedidos repetidos dentro de 60 s para a mesma posição são ignorados (`skipped`). Falhas são logadas (`event: reading_warm`) e nunca propagadas. O job chama `POST /v1/tts` do `speech` com `X-Speech-Priority: low`.
- Desligado com `READING_WARM_ENABLED=false` → `202 {"queued": 0, "skipped": 0, "enabled": false}`.

### 3.3 Idioma
- `detect_language(sample_text) -> "en" | "pt" | "es" | "unknown"` em `material_corpus` (razão de stopwords sobre as primeiras 20.000 palavras legíveis do livro; `unknown` abaixo de 2 % de acerto). Cacheado com o corpus.
- `library.books[].language`, `GET /sections/{id}.language` e `offline-manifest.book.language`.
- Com `language != "en"`: `POST …/tts`, `GET …/tts/stream`, `POST …/warm` e `POST …/assess` respondem 409 `language_unsupported` (`{"language": "pt"}` em `detail`). O leitor usa a voz do navegador no idioma do livro.

### 3.4 Velocidades e capacidades
- `READING_SPEEDS = (0.5, 0.6, 0.75, 0.9, 1.0, 1.1, 1.25)`.
- `capabilities.tts` ganha `"streaming": true` e `capabilities.warm = {"enabled": true, "blocks_ahead": 6}`.

### 3.5 Variáveis
| Variável | Default | Descrição |
|---|---|---|
| `READING_WARM_ENABLED` / `READING_WARM_BLOCKS_AHEAD` / `READING_WARM_WORKERS` / `READING_WARM_QUEUE_MAX` | `true` / `6` / `1` / `200` | aquecimento |
| `SPEECH_STREAM_TIMEOUT_SECONDS` | `300` | leitura do stream |

## 4. Frontend

### 4.1 Reprodução por frases
- Nova fonte `loadStream(params, onSegment)` no `ReaderSource` online: consome o NDJSON (`fetch` + `ReadableStream`, credenciais incluídas), baixa o áudio de cada frase assim que a linha chega e entrega ao player. Offline continua com o áudio do bloco.
- Player por **lista de segmentos** (`HTMLAudioElement` com duplo buffer: a próxima frase já carregada com `preload=auto` e blob URL). Linha do tempo única (`offset da frase + currentTime`) para destaque de palavra, barra, `seek` por palavra e MediaSession; `playbackRate` 1 (a velocidade já vem do servidor). Fim da última frase = fim do bloco.
- Lacuna entre frases alvo ≤ 60 ms (medida no teste unitário com relógio falso). Se uma frase ainda não chegou quando a anterior acaba, estado `buffering` (indicador discreto), e segue ao chegar.
- Fallback: `GET …/tts/stream` 404/405 (servidor antigo) → modo bloco atual.

### 4.2 Antecipação
- Ao começar a tocar um bloco: `loadStream` do próximo bloco em segundo plano (frases + áudio), limitado a **1 bloco à frente**; no último bloco da seção, `GET /sections/{next}` e stream do seu primeiro bloco (cache do react-query, para a navegação já encontrar tudo).
- Ao abrir uma seção (e a cada mudança de voz/velocidade): `POST …/warm` com o bloco atual, com debounce de 2 s e no máximo 1 chamada por 60 s por seção.

### 4.3 "Ouvir e repetir" (modo novo, ao lado de Ouvir · Frase a frase · Shadowing)
Máquina de estados por frase: `model` (toca a frase) → `cue` (300 ms, sinal visual e bip curto opcional) → `recording` (abre o microfone; para por **silêncio**: energia RMS abaixo do limiar por 1,2 s depois de ter detectado voz, ou teto = `max(4 s, 2 × duração da frase + 2 s)`) → `assessing` → `result` (3 s; nota, palavras marcadas) → próxima frase se `overall ≥ 0,85`, senão repete a mesma até 3 vezes e segue. Pausa/retomar; `Esc` sai. Reutiliza `useRecording` com a opção nova `stopOnSilence`. Progresso por frase visível ("frase 3 de 8").

### 4.4 Outros
- Velocidades vindas das capacidades (0,5× e 0,6× aparecem).
- Idioma ≠ `en`: aviso na seção e na biblioteca; Ouvir usa `speechSynthesis` com `lang` do livro; Shadowing, Frase a frase e Ouvir e repetir desativados com explicação.
- Testes: divisão NDJSON e ordem dos segmentos, player de segmentos (lacuna, seek, fim), antecipação (1 à frente, próxima seção), detecção de silêncio (RMS sintético), máquina de estados do "ouvir e repetir" (relógio falso), fallback para modo bloco. E2E: tocar um bloco em streaming com o provedor fake e completar um ciclo de "ouvir e repetir" com `MediaRecorder` falso.

## 5. Compose e operação
- `APP_SPEECH_*_THREADS` e `APP_SPEECH_MAX_CONCURRENCY` default `0` (automático); `APP_SPEECH_PARALLEL_PHONEMES=auto`; `APP_SPEECH_CACHE_MAX_MB=8192`.
- `APP_SPEECH_CPUS` default `2.0` (cabe em qualquer máquina; suba conforme os núcleos). README: tabela por tamanho de máquina (4 vCPU, 8, 16).

## 6. Desvios da implementação (medidos, ver `speech/README.md`)

| Contrato | Implementado | Por quê |
|---|---|---|
| Threads automáticas = `effective_cpus` em cada engine (§2.4) | Teto de 8 threads; com fonemas em paralelo, o wav2vec2 fica com metade e o Whisper com o resto | Medido no M1 Pro: faster-whisper com 10 threads é 3,4× mais lento que com 4 (7,1 s × 2,1 s); a regra literal com paralelo ligado foi a pior configuração (16 s × 4,8 s num clipe de 43 s). Numa VM de 3 a 4 vCPUs nada muda. Valores explícitos continuam valendo |
| Bloco a partir de frases em cache "não sintetiza nada" (§2.1) | O PCM das últimas 64 frases fica em memória; fora disso, o arquivo MP3 da frase é **decodificado** e concatenado (um único encode do bloco) | Zero inferência mesmo; o custo é um MP3 de segunda geração a 64 kb/s, inaudível |
| Slot do limitador por frase | Um stream segura um slot de TTS do primeiro trecho não cacheado até o fim | Simplicidade; frases em cache saem sem slot |
| `X-Speech-Priority` inválido | tratado como `normal` | não especificado |
