# Sentinel Speech (serviço de voz)

Serviço interno do **Sentinel Reader** (contrato: `docs/reading/CONTRATO-INCREMENTO-1.md`, §5).
FastAPI + Python 3.12, só CPU, alcançado apenas pela API (`http://speech:8100` na rede `speech`).

| Papel | Engine padrão | Alternativas |
|---|---|---|
| TTS com timestamps por palavra | **Kokoro-82M** (`hexgrad/Kokoro-82M`, `kokoro` 0.9.4 + `misaki[en]`, torch CPU) | `fake` (testes), `none` |
| ASR com timestamps por palavra | **faster-whisper** `small.en` (`int8`, CTranslate2) | `mlx-whisper` (Apple Silicon), `fake`, `none` |
| G2P (IPA esperado × ouvido) | misaki `en` (+ `espeak-ng` para palavras fora do dicionário) | — |

## Endpoints

| Rota | Entrada | Saída |
|---|---|---|
| `GET /healthz` | — | `{"status": "ok\|warming\|degraded", "tts": {engine, model, ready, voices[], default_voice, format}, "asr": {engine, model, ready}}` — sempre 200 |
| `POST /v1/tts` | `{"text" (≤ 2000), "voice", "speed" (0.5–1.5), "lang": "en-us\|en-gb"}` | `{audio_id, content_type, duration_seconds, sample_rate, cached, engine, model, voice, speed, lang, words[{text,start,end,char_start,char_end}]}` |
| `GET /v1/audio/{audio_id}` | — | bytes (`audio/mpeg` com ffmpeg, senão `audio/wav`), `Cache-Control: private, max-age=86400`; 404 `audio_not_found` |
| `POST /v1/assess` | multipart: `audio` (webm/ogg/mp4/wav…), `reference_text` (≤ 2000), `lang` (`en`) | corpo do §4.7 do contrato sem `attempt_id`/`created_at`/`best_overall`/`attempts_for_block` |

Erros: `{code, message}` — 400 `text_required` / `text_too_long` / `voice_invalid` / `lang_invalid` / `audio_invalid`,
401 `unauthorized` (quando `SPEECH_API_TOKEN` está definido; `/healthz` fica aberto), 413 `audio_too_large`,
503 `model_not_ready` / `engine_disabled` / `busy` (com `Retry-After: 5`).

- `audio_id` = sha256(engine, model, voice, speed, lang, text). Cache em disco em `SPEECH_CACHE_DIR/tts/<id>.mp3|wav` + `<id>.json` (palavras), LRU por tamanho (`SPEECH_CACHE_MAX_MB`). **Só o áudio sintetizado é cacheado; a gravação enviada nunca toca o disco** (passa por um arquivo temporário do ffmpeg apagado na mesma chamada).
- Inferência em thread pool com um `asyncio.Semaphore` por engine (`SPEECH_MAX_CONCURRENCY`); espera até 60 s e responde 503 `busy`. Hit de cache não passa pelo semáforo.
- Sem `initial_prompt` no Whisper (o texto de referência enviesaria o modelo a "corrigir" a pronúncia).

## Como funciona a avaliação

1. `ffmpeg` decodifica o upload para PCM 16 kHz mono; faster-whisper transcreve com `word_timestamps=True`, `beam_size=5`, `temperature=0`, `vad_filter=True`.
2. Referência e transcrição são normalizadas (`speech/textnorm.py`): minúsculas, sem pontuação, apóstrofos preservados, números 0–9999 e ordinais por extenso (`2nd` → `second`, `50%` → `fifty percent`, `&` → `and`). Hífens são ignorados na comparação (`multi-factor` = `multifactor` = `multi` + `factor`).
3. Alinhamento Levenshtein/Needleman-Wunsch (`speech/alignment.py`): substituição custa `1 − ratio/100` (rapidfuzz) quando `ratio ≥ 50`, senão 1; inserção/omissão custam 1. Um token de referência que expande para N palavras pode casar com N palavras ouvidas.
4. Status por palavra: `ok` (igual, confiança ≥ 0,6), `weak` (igual, confiança < 0,6), `mispronounced` (substituída; `heard` traz o que foi ouvido), `missed` (omitida). Inserções vão para `extras` com `after_index`.
5. Notas (`speech/scoring.py`): `accuracy = (ok + 0,5·weak)/ref`, `completeness = (ref − missed)/ref`, `fluency = clamp(1 − 0,5·wpm_penalty − 0,1·pausas_longas − 0,05·extras)`, `overall = 0,6·acc + 0,2·comp + 0,2·flu`. `wpm = palavras tentadas / (fim da última ouvida − início da primeira) × 60`; `wpm_penalty = 0` em [120, 170], senão distância/60 (máx. 1). Pausa longa = intervalo > 0,8 s entre palavras ouvidas.
6. `expected_ipa`/`heard_ipa` (misaki) só para `weak`/`mispronounced`; `tips` agrega as confusões de fonema mais frequentes (diff caractere a caractere do IPA, top 3).

## Rodar nativo no Mac (M1 Pro)

```bash
brew install espeak-ng ffmpeg          # espeak-ng: fallback do misaki; ffmpeg: mp3 + decodificação dos uploads
cd speech
uv sync                                # cria .venv com Python 3.12 (torch CPU/MPS de PyPI, ~2 GB de deps)
SPEECH_CACHE_DIR=./.cache uv run speech-server
# modelos baixam do Hugging Face no primeiro start para $SPEECH_CACHE_DIR/hf (~780 MB: Kokoro 330 MB + small.en 480 MB)
curl -s localhost:8100/healthz | jq .status        # "warming" até carregar, depois "ok"
```

Exemplos:

```bash
curl -s localhost:8100/v1/tts -H 'content-type: application/json' \
  -d '{"text":"Security awareness training teaches employees to recognize phishing.","voice":"af_heart","speed":1.0}' | jq .
curl -s localhost:8100/v1/audio/<audio_id> -o out.mp3
curl -s -F audio=@gravacao.webm -F 'reference_text=Security awareness training teaches employees to recognize phishing.' \
  localhost:8100/v1/assess | jq '.scores, .metrics'
```

ASR nativo com Metal (opcional, mais rápido que CTranslate2 no M1):

```bash
uv sync --extra mlx
SPEECH_ASR_ENGINE=mlx-whisper SPEECH_ASR_MODEL=mlx-community/whisper-small.en-mlx uv run speech-server
```

A API local aponta `SPEECH_SERVICE_URL=http://127.0.0.1:8100`.

### Variáveis de ambiente (§5.3)

| Variável | Default | Descrição |
|---|---|---|
| `SPEECH_HOST` / `SPEECH_PORT` | `0.0.0.0` / `8100` | bind |
| `SPEECH_TTS_ENGINE` / `SPEECH_TTS_MODEL` | `kokoro` / `hexgrad/Kokoro-82M` | `kokoro\|fake\|none` |
| `SPEECH_TTS_DEFAULT_VOICE` / `SPEECH_TTS_VOICES` | `af_heart` / `af_heart,af_bella,af_nicole,am_michael,am_adam,bf_emma,bm_george` | vozes oferecidas (ids desconhecidos → 400 `voice_invalid`) |
| `SPEECH_ASR_ENGINE` / `SPEECH_ASR_MODEL` | `faster-whisper` / `small.en` | `faster-whisper\|mlx-whisper\|fake\|none` |
| `SPEECH_ASR_COMPUTE_TYPE` / `SPEECH_ASR_THREADS` | `int8` / `4` | CTranslate2 |
| `SPEECH_AUDIO_FORMAT` | `mp3` | `mp3` (ffmpeg, 64 kb/s mono) ou `wav`; sem ffmpeg cai para `wav` |
| `SPEECH_CACHE_DIR` / `SPEECH_CACHE_MAX_MB` | `/var/cache/speech` / `2048` | cache do áudio sintetizado (`0` = sem limite) |
| `SPEECH_MAX_AUDIO_BYTES` / `SPEECH_MAX_TEXT_CHARS` | `8000000` / `2000` | limites |
| `SPEECH_MAX_CONCURRENCY` / `SPEECH_BUSY_WAIT_SECONDS` | `2` / `60` | inferências simultâneas por engine e espera antes de 503 `busy` |
| `SPEECH_PRELOAD` | `true` | carrega os modelos no start em thread de fundo (`/healthz` = `warming`); `false` = carrega no primeiro uso |
| `SPEECH_API_TOKEN` | vazio | `Authorization: Bearer …` exigido em `/v1/*` quando definido |
| `SPEECH_LOG_LEVEL` | `INFO` | nível de log |
| `HF_HOME` | `$SPEECH_CACHE_DIR/hf` | cache dos modelos (Hugging Face) |

## Testes

```bash
cd speech && uv run pytest      # 37 testes, ~15 s (engines fake; não baixam modelos)
```

Os testes de API usam `SPEECH_TTS_ENGINE=fake SPEECH_ASR_ENGINE=fake`. O ASR fake lê a "transcrição" do próprio upload:
bytes UTF-8 começando com `FAKE:` (tokens podem levar `@prob`, ex.: `FAKE:security awareness@0.3 training`); qualquer outro conteúdo é "ouvido" igual ao texto de referência.

## Docker

```bash
docker build -t sentinel-quiz-speech speech/
docker run --rm -p 8100:8100 -v speech_models:/var/cache/speech sentinel-quiz-speech
```

Imagem `python:3.12-slim` multi-stage, torch **só CPU** (índice `download.pytorch.org/whl/cpu`), pacotes `ffmpeg espeak-ng libsndfile1`, usuário não-root, `HF_HOME=/var/cache/speech/hf`, `SPEECH_CACHE_DIR=/var/cache/speech`, `HEALTHCHECK` em `/healthz` (`start-period` de 10 min para o primeiro download). **Pesos não vão na imagem**: baixam no primeiro start para o volume.

## Latências medidas (MacBook Pro M1 Pro, 32 GB, CPU, 2026-10-12)

Engines reais (Kokoro-82M + faster-whisper `small.en` int8, 4 threads), servidor nativo via `uv run speech-server`, parágrafos de 3 frases (~25 palavras, 11–14 s de áudio):

| Métrica | Valor |
|---|---|
| Start a frio (download Kokoro + small.en + carga) | ~46 s; com modelos em cache ~15 s |
| TTS, primeira chamada após carga | 2,28 s para 13,8 s de áudio (**0,165 s por segundo de áudio**) |
| TTS, regime (3 parágrafos) | **0,135 s por segundo de áudio** (1,4–1,7 s por parágrafo) |
| TTS, hit de cache | 9 ms |
| Assess (decodificação mp3 + ASR + alinhamento + IPA), primeira chamada | 2,23 s para clipe de 13,8 s |
| Assess, regime (3 clipes de ~11,5 s) | **1,38 s por clipe (0,12 s por segundo de áudio)** |
| Voz nova (`bm_george`, inclui download do `.pt`) a 1,25× | 5,7 s para 12,1 s de áudio |
| RSS do processo | 2,3 GB após carregar os dois modelos; 2,6–2,9 GB em uso |

Qualidade no smoke test (áudio do próprio Kokoro re-avaliado contra o texto): 25 `ok` + 1 `weak` em 26 palavras, `overall` 0,945; com uma palavra extra e uma trocada na referência, o serviço marcou exatamente a extra como `missed` e a trocada como `mispronounced` (`heard` = palavra falada), `overall` 0,894. Os `words` do TTS saíram com `start < end` e `text[char_start:char_end] == text` em 100% das palavras.

Observação sobre memória: com ~2,3–2,9 GB de RSS, o limite `APP_SPEECH_MEMORY=3g` do compose fica apertado; recomenda-se 4g.

## Limitações conhecidas

- Números lidos de forma diferente da expansão simples (`2024` como "twenty twenty-four") contam como `mispronounced` + `extras`.
- Pausas de fim de frase do Kokoro (> 0,8 s) contam como pausas longas quando se avalia o próprio áudio sintetizado; em leitura humana o efeito é o desejado.
- `tips` usa diff de caracteres do IPA (sem segmentação de fonemas compostos).
