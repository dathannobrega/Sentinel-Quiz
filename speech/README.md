# Sentinel Speech (serviço de voz)

Serviço interno do **Sentinel Reader** (contratos: `docs/reading/CONTRATO-INCREMENTO-1.md` §5,
`docs/reading/CONTRATO-INCREMENTO-2.md` §2 e `docs/reading/CONTRATO-INCREMENTO-3.md` §2). FastAPI + Python 3.12, só CPU,
alcançado apenas pela API (`http://speech:8100` na rede `speech`).

| Papel | Engine padrão | Alternativas |
|---|---|---|
| TTS com timestamps por palavra | **Kokoro-82M** (`hexgrad/Kokoro-82M`, `kokoro` 0.9.4 + `misaki[en]`, torch CPU) | `fake` (testes), `none` |
| ASR com timestamps por palavra | **faster-whisper** `small.en` (`int8`, CTranslate2) | `mlx-whisper` (Apple Silicon), `fake`, `none` |
| Fonemas (GOP) | **wav2vec2** `facebook/wav2vec2-lv-60-espeak-cv-ft` (CTC sobre fonemas IPA do espeak; **Apache-2.0**, conferido no model card em 2026-10-12) | `fake` (testes), `none` |
| G2P (IPA esperado) | binário `espeak-ng` (`-q --ipa=3 -v en-us`) | misaki `en` convertido para IPA padrão quando não há espeak-ng |

## Endpoints

| Rota | Entrada | Saída |
|---|---|---|
| `GET /healthz` | — | `{"status": "ok\|warming\|degraded", "tts": {engine, model, ready, voices[], default_voice, format}, "asr": {engine, model, ready}, "phoneme": {engine, model, ready, error}, "runtime": {effective_cpus, threads{asr,torch,phoneme}, max_concurrency, parallel_phonemes}}` — sempre 200; `ok` só depende de TTS e ASR |
| `POST /v1/tts` | `{"text" (≤ 2000), "voice", "speed" (0.5–1.5), "lang": "en-us\|en-gb"}` | `{audio_id, content_type, duration_seconds, sample_rate, cached, engine, model, voice, speed, lang, words[{text,start,end,char_start,char_end}]}` — o bloco inteiro, montado a partir das frases (ver abaixo) |
| `POST /v1/tts/stream` | mesmo corpo de `/v1/tts` | `application/x-ndjson`, uma linha por evento assim que cada frase fica pronta: `{"type":"meta", block_audio_id, sentences, engine, model, voice, speed, lang, content_type}` → `{"type":"segment", index, audio_id, char_start, char_end, duration_seconds, cached, words[]}`… → `{"type":"done", duration_seconds}`. Erro depois de `meta`: `{"type":"error", code, message}` e fim do corpo (status já era 200); antes: JSON normal (400/503). `Cache-Control: no-store`, `X-Accel-Buffering: no` |
| `GET /v1/audio/{audio_id}` | — | bytes (`audio/mpeg` com ffmpeg, senão `audio/wav`), `Cache-Control: private, max-age=86400`; 404 `audio_not_found` |
| `POST /v1/assess` | multipart: `audio` (webm/ogg/mp4/wav…), `reference_text` (≤ 2000), `lang` (`en`) | corpo do §4.7 do contrato 1 sem `attempt_id`/`created_at`/`best_overall`/`attempts_for_block`, mais os campos do contrato 2 §2.5 (`reason`, `phoneme_score`, `phonemes`, `break` por palavra; `scores.prosody`, `prosody`, `engines`) |
| `POST /v1/g2p` | `{"words": [...] (1–50, ≤ 64 chars), "lang": "en-us\|en-gb"}` | `{"items": [{"word", "ipa"}]}` (IPA padrão com acento; `null` se falhar) |
| `GET /metrics` | — (Bearer quando `SPEECH_API_TOKEN` está definido) | Prometheus: `speech_requests_total{route,status,priority}`, `speech_inference_seconds{engine}`, `speech_queue_wait_seconds{engine,priority}` (histograma da espera por slot), `speech_tts_cache_hits_total`, `speech_tts_cache_misses_total`, `speech_tts_cache_bytes`, `speech_model_ready{engine}` |

Erros: `{code, message}` — 400 `text_required` / `text_too_long` / `voice_invalid` / `lang_invalid` / `audio_invalid`,
401 `unauthorized` (quando `SPEECH_API_TOKEN` está definido; `/healthz` fica aberto), 413 `audio_too_large`,
503 `model_not_ready` / `engine_disabled` / `busy` (com `Retry-After: 5`).

- `audio_id` = sha256(engine, model, voice, speed, lang, text) — vale para frases e para blocos. Cache em disco em `SPEECH_CACHE_DIR/tts/<id>.mp3|wav` + `<id>.json` (palavras), LRU por tamanho (`SPEECH_CACHE_MAX_MB`, 8 GB por padrão). **Só o áudio sintetizado é cacheado; a gravação enviada nunca toca o disco** (passa por um arquivo temporário do ffmpeg apagado na mesma chamada).
- Inferência em thread pool atrás de uma **fila com duas classes por engine** (`SPEECH_MAX_CONCURRENCY` slots; cabeçalho `X-Speech-Priority: low|normal`, default `normal`; valores desconhecidos contam como `normal`). Um pedido `low` (aquecimento) só pega um slot quando **nenhum** `normal` está esperando; `normal` nunca espera por `low` além do slot já em uso. `normal` espera até `SPEECH_BUSY_WAIT_SECONDS` (60 s) e `low` até `SPEECH_LOW_PRIORITY_WAIT_SECONDS` (20 s) antes do 503 `busy`. Hit de cache não passa pela fila. Vale para `/v1/tts`, `/v1/tts/stream` e `/v1/assess`.
- Sem `initial_prompt` no Whisper (o texto de referência enviesaria o modelo a "corrigir" a pronúncia).

## Frases, stream e prioridade (Incremento 3)

**Frase = unidade de síntese e de cache.** `textnorm.split_sentences(text)` devolve `(char_start, char_end)` de cada frase com a
**mesma regex do corpus** (`backend/app/services/material_corpus.py::_SENTENCE_BREAK`, `(?<=[.!?:])\s+(?=[A-Z0-9“"(•])`), depois
junta frases com menos de 3 palavras à anterior (ou à seguinte, quando abrem o bloco) e corta qualquer frase acima de 400
caracteres na vírgula mais próxima do meio (dentro de 25 % do comprimento), senão no espaço mais próximo do meio. Os offsets
indexam o texto do bloco e nunca se sobrepõem.

Cada frase é sintetizada e cacheada com `audio_id` próprio (`audio_id_for(engine, model, voice, speed, lang, texto_da_frase)`); o
`.json` da frase guarda as palavras relativas à própria frase, de modo que a mesma frase em outro bloco (ou em outra posição) acerta
o mesmo cache. Na saída (`segment` do stream e `service.synthesize_sentences`) as palavras saem com `char_start/char_end`
**relativos ao bloco** e `start/end` relativos ao áudio da frase.

**Bloco.** `POST /v1/tts` continua devolvendo o bloco inteiro com o **mesmo `audio_id` de antes** (clientes offline que guardaram
o id seguem funcionando): o serviço pega o PCM de cada frase, concatena (sem silêncio inserido — o Kokoro já fecha cada frase com
a pausa natural; a soma das durações das frases é exatamente a duração do bloco) e codifica **uma vez**. Um bloco cujas frases já
estão em cache **não sintetiza nada** (0 chamadas ao Kokoro, medido). Como o cache em disco guarda o áudio codificado, o PCM vem
de um LRU em memória com as últimas `SPEECH_SENTENCE_PCM_LRU` (64) frases — o caso comum é o stream seguido do download do bloco —
e, fora dele, da **decodificação do arquivo cacheado** (ffmpeg para mp3, soundfile para wav; milissegundos), ajustada ao número
exato de amostras da duração registrada. Trade-off assumido: um bloco montado a partir de frases decodificadas carrega uma
segunda geração de MP3 (64 kb/s mono, inaudível para fala) em troca de nunca gastar CPU de síntese, que é o que o contrato
pede; o `words` do bloco é exatamente o das frases deslocado pela soma das durações (igualdade verificada no smoke test). Um bloco
de uma única frase é a própria frase (mesmo id, sem recodificar).

**Stream.** `POST /v1/tts/stream` valida como `/v1/tts` (erros 400/503 em JSON normal, inclusive `model_not_ready`), emite
`meta` e então uma linha `segment` por frase. Frases em cache saem imediatamente, sem slot; a primeira frase não cacheada pega
**um** slot da fila do TTS e o mantém até o fim do stream (liberar entre frases deixaria outro bloco se intercalar e travar este
leitor no meio do parágrafo; a fila de prioridade já segura o aquecimento atrás dos leitores). A síntese roda no thread pool do
Starlette (o event loop nunca bloqueia) e o laço verifica `request.is_disconnected()` antes de cada frase: cliente que fechou a
aba não gasta mais CPU. Erro depois de `meta` (inclusive `busy` ao pedir o slot) vira a linha `{"type":"error",…}`. O stream não
gera o bloco; quem precisar dele (download offline) chama `/v1/tts`, que reaproveita as frases.

**Threads e concorrência automáticas** (`speech/runtime.py`). `effective_cpus()` lê a cota do cgroup v2
(`/sys/fs/cgroup/cpu.max`, arredondada para cima) ou v1 (`cpu.cfs_quota_us/cpu.cfs_period_us`), limitada aos núcleos que o host
expõe (`sched_getaffinity`, senão `os.cpu_count()`). Com `SPEECH_ASR_THREADS`/`SPEECH_TORCH_THREADS`/`SPEECH_PHONEME_THREADS` em
`0` (default) cada engine usa `max(1, effective_cpus)` **limitado a 8**; `SPEECH_MAX_CONCURRENCY=0` vira `1` abaixo de 6 CPUs e
`2` a partir daí; `SPEECH_PARALLEL_PHONEMES=auto` liga o paralelo só com 6+ CPUs. Com o paralelo ligado (por `auto` ou `on`), o
forward do wav2vec2 começa numa thread própria assim que o PCM existe, enquanto o Whisper transcreve (os dois só precisam do PCM);
o alinhamento fonético continua depois do Whisper, com o resultado idêntico ao sequencial (testado). Nesse caso o orçamento de
threads é **dividido**: wav2vec2 `max(1, threads // 2)`, Whisper o resto. O runtime resolvido aparece em `/healthz.runtime` e no
log de start (`runtime: effective_cpus=… threads(asr=… torch=… phoneme=…) max_concurrency=… parallel_phonemes=…`). Valores
explícitos (> 0) sempre vencem.

| `effective_cpus` | threads asr / torch / phoneme | `max_concurrency` | fonemas em paralelo |
|---:|---|---:|---|
| 2 | 2 / 2 / 2 | 1 | não |
| 3–4 (VM alvo) | 3 / 3 / 3 · 4 / 4 / 4 | 1 | não |
| 6 | 3 / 6 / 3 | 2 | sim |
| 8 | 4 / 8 / 4 | 2 | sim |
| 16 | 4 / 8 / 4 (`off`: 8 / 8 / 8) | 2 | sim |

Desvios do contrato 3 §2.4, decididos com medição (tabela em "Incremento 3" abaixo): o contrato manda `threads = effective_cpus`
para cada engine e só reduz as do wav2vec2 quando o paralelo é forçado em máquina pequena. Neste M1 Pro (10 CPUs lógicas), o
faster-whisper `small.en` int8 com 10 threads ficou **3,4× mais lento** do que com 4 (7,1 s × 2,1 s num clipe de 27 s) e os dois
modelos juntos com 10 + 5 threads foram a pior configuração medida (16 s para o clipe de 43 s contra 4,8 s). Por isso o
automático **limita as threads a 8** e **divide** o orçamento entre Whisper e wav2vec2 sempre que rodam ao mesmo tempo. Na VM alvo
de 3–4 vCPUs nada muda (threads = CPUs, paralelo desligado). Em Apple Silicon, se quiser o melhor absoluto, fixe
`SPEECH_ASR_THREADS=4` (núcleos de desempenho).

## Como funciona a avaliação

1. `ffmpeg` decodifica o upload para PCM 16 kHz mono; faster-whisper transcreve com `word_timestamps=True`, `beam_size=5`, `temperature=0`, `vad_filter=True`.
2. Referência e transcrição são normalizadas (`speech/textnorm.py`): minúsculas, sem pontuação, apóstrofos preservados, números 0–9999 e ordinais por extenso (`2nd` → `second`, `50%` → `fifty percent`, `&` → `and`). Hífens são ignorados na comparação (`multi-factor` = `multifactor` = `multi` + `factor`).
3. Alinhamento Levenshtein/Needleman-Wunsch (`speech/alignment.py`): substituição custa `1 − ratio/100` (rapidfuzz) quando `ratio ≥ 50`, senão 1; inserção/omissão custam 1. Um token de referência que expande para N palavras pode casar com N palavras ouvidas.
4. Status e `reason` por palavra: `ok` (igual, confiança ≥ `SPEECH_WEAK_CONFIDENCE`); `weak` + `low_confidence` (igual, confiança menor); `weak` + `ending` (só muda o final possessivo/plural: `organization's`/`organizations` × `organization`, `its` × `it's`); `mispronounced` + `substitution` (outra palavra; `heard` traz o que foi ouvido); `missed` (omitida). Inserções vão para `extras` com `after_index`. **Homófonos não são erro:** se a palavra ouvida soa igual à esperada segundo o espeak-ng (`phishing`/`fishing`, `recognise`/`recognize`, `two`/`too`), a troca é desfeita (o Whisper só escolheu outra grafia).
5. **Fonemas (GOP, `speech/phonemes.py`)**, com a engine ativa e pronta:
   - um único forward do wav2vec2 na gravação inteira (50 frames/s; áudio > 31 s vai em blocos de 30 s com 1 s de contexto de cada lado);
   - fonemas esperados de cada palavra pelo binário `espeak-ng` (uma chamada por avaliação para as palavras ainda não cacheadas; cache em memória), quebrados nos tokens do vocabulário do modelo por *longest match* dentro de cada unidade ligada pelo espeak (o `--ipa=3` liga ditongos/africadas com U+200D, ex.: `a‍ɪ` → `aɪ`, `ɔː‍ɹ` → `ɔːɹ`); acentos `ˈˌ` saem (não existem no vocabulário) e o `ɹ` de ligação depois de token r-colorido (`ʊɹ ɹ`) é fundido;
   - variantes de pronúncia: forma de citação do espeak, forma dentro da frase (quando a divisão de palavras do espeak bate) e formas fracas das palavras funcionais (`a` → `ɐ/ə`, `the` → `ðə/ði`, `to` → `tə`…); vale a de maior nota;
   - **alinhamento forçado CTC (Viterbi em numpy) conjunto**: todos os fonemas esperados das palavras ouvidas num único Viterbi, cada palavra restrita a `[start − 0,5 s, end + 0,5 s]` dos tempos do Whisper (ver "Desvios" abaixo);
   - por fonema `gop = média(log P(esperado) − max_q log P(q))` nos frames alinhados (q inclui o branco), `score = exp(gop)`, `heard` = token não-branco de maior massa nesses frames, `quality` = `good` (≥ 0,75) / `fair` (≥ 0,5) / `bad`. `P(esperado)` soma as realizações equivalentes de sotaque (vogais reduzidas `ᵻ/ɪ/ə/ɐ`, `ɔː/ɑː`, flap `ɾ/t/d`, `ɚ/ɜː`, r-colorido × não-rótico…); os erros clássicos de aprendiz (`θ/t`, `ð/d`, `v/w`, `ɪ/iː`, `æ/ɛ`) continuam estritos;
   - `phoneme_score` da palavra = média dos `score`; abaixo de `SPEECH_PHONEME_WORD_THRESHOLD` uma palavra `ok`/`weak` vira `mispronounced` com `reason: "phoneme"`;
   - `expected_ipa`/`heard_ipa` passam a ser os fonemas do espeak (esperado, com acento) e os ouvidos. Sem a engine (ou com ela em `warming`), `expected_ipa`/`heard_ipa` vêm do misaki **convertido para IPA padrão** (`A→eɪ`, `I→aɪ`, `W→aʊ`, `Y→ɔɪ`, `O→oʊ`, `Q→əʊ`, `T→ɾ`, `ʤ→dʒ`, `ʧ→tʃ`, `ᵊ→ə`), só para `weak`/`mispronounced`, e `engines.phoneme = null`.
6. **Prosódia (`speech/prosody.py`)**: F0 por autocorrelação normalizada (janela 40 ms, passo 10 ms, 75–400 Hz, só frames com voz, saltos de oitava descartados); `pitch_range_semitones` = desvio-padrão do F0 em semitons; `monotone` < 2,0. `break` por palavra: `unexpected` (pausa > 0,5 s antes dela sem `, . ; : ! ?` na referência), `missing` (palavra que fecha frase com `. ! ?` e a próxima começa < 0,12 s depois). `prosody.score = clamp(1 − 0,1·unexpected − 0,05·missing − 0,3·monotone)`; `prosody = null` com menos de 3 palavras ouvidas.
7. Notas (`speech/scoring.py`): `word_acc` = `missed` 0, troca 0,25, senão `phoneme_score` (com a engine) ou `ok` 1 / `weak` 0,5 / `mispronounced` 0; `accuracy` = média; `completeness = (ref − missed)/ref`; `fluency = clamp(1 − 0,5·wpm_penalty − 0,1·pausas_longas − 0,05·extras)` onde pausa longa (> 0,8 s) **depois de pontuação da referência não conta**; `overall` = média ponderada por `SPEECH_SCORE_WEIGHTS` (accuracy, completeness, fluency, prosody), com o peso da prosódia redistribuído quando ela é `null`.
8. `tips`: com a engine, os pares (esperado × ouvido) mais frequentes entre fonemas `bad` (até 3, com até 3 palavras de exemplo); sem ela, o diff de caracteres do IPA das palavras `mispronounced` (Inc. 1).

### Desvios do contrato 2 (decididos com dados; ver `docs/reading/CALIBRACAO.md`)

- **Janela do GOP.** O contrato fixa `[start − 0,08 s, end + 0,08 s]` por palavra. Os tempos de palavra do Whisper chegam a errar 0,1–0,3 s e a janela curta corta o último fonema: lendo o próprio áudio do Kokoro, 16% das palavras corretas ficavam abaixo de 0,6 (7,8% mesmo com equivalências e formas fracas). O serviço faz o mesmo Viterbi CTC, mas num passe conjunto com cada palavra limitada a ±0,5 s dos tempos do Whisper (os vizinhos "seguram" cada fonema); com tudo junto, 0% das palavras corretas abaixo de 0,6 e média 0,99 (ablação em `docs/reading/CALIBRACAO.md`). A janela de 0,08 s continua no código (`score_word`) e é o caminho de reserva se o alinhamento conjunto for inviável.
- **Equivalências de sotaque e formas fracas** (item 5 acima): sem elas, `a` lido como `ɐ` (forma natural na frase) tirava 0 contra o `eɪ` de citação do espeak.
- **Homófonos** deixam de ser `substitution` (item 4).

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
| `SPEECH_ASR_COMPUTE_TYPE` / `SPEECH_ASR_THREADS` | `int8` / `0` | CTranslate2; `0` = automático (`effective_cpus`, máx. 8; metade quando os fonemas rodam em paralelo) |
| `SPEECH_TORCH_THREADS` | `0` | threads do torch (Kokoro); `0` = automático (`effective_cpus`, máx. 8) |
| `SPEECH_PHONEME_ENGINE` | `wav2vec2` | `wav2vec2\|fake\|none`; sem ela a avaliação sai sem fonemas (`engines.phoneme = null`) |
| `SPEECH_PHONEME_MODEL` | `facebook/wav2vec2-lv-60-espeak-cv-ft` | checkpoint CTC de fonemas do espeak (Apache-2.0); alternativa leve na mesma licença: `facebook/wav2vec2-xlsr-53-espeak-cv-ft` |
| `SPEECH_PHONEME_THREADS` | `0` | threads do torch durante o forward do wav2vec2 (ajustadas e restauradas a cada chamada; os forwards são serializados); `0` = automático (`effective_cpus`, máx. 8; `max(1, threads // 2)` com paralelo ligado) |
| `SPEECH_PARALLEL_PHONEMES` | `auto` | `auto` (paralelo só com 6+ CPUs) \| `on` \| `off`: forward do wav2vec2 em thread própria enquanto o Whisper transcreve |
| `SPEECH_PHONEME_WORD_THRESHOLD` | `0.6` | `phoneme_score` abaixo disso rebaixa `ok`/`weak` para `mispronounced` (`reason: "phoneme"`) |
| `SPEECH_WEAK_CONFIDENCE` | `0.6` | probabilidade do Whisper abaixo da qual uma palavra certa vira `weak` (`low_confidence`) |
| `SPEECH_SCORE_WEIGHTS` | `0.5,0.2,0.15,0.15` | pesos de accuracy, completeness, fluency, prosody no `overall` |
| `SPEECH_AUDIO_FORMAT` | `mp3` | `mp3` (ffmpeg, 64 kb/s mono) ou `wav`; sem ffmpeg cai para `wav` |
| `SPEECH_CACHE_DIR` / `SPEECH_CACHE_MAX_MB` | `/var/cache/speech` / `8192` | cache do áudio sintetizado, frases e blocos (`0` = sem limite). Disco: ~8 kB por segundo de áudio em mp3 64 kb/s; um livro de 12 h de leitura ≈ 350 MB por voz e velocidade (frases + blocos ≈ 2×) |
| `SPEECH_SENTENCE_PCM_LRU` | `64` | frases recentes mantidas em PCM na memória para montar blocos (~0,1 MB por segundo de áudio; 64 frases ≈ 40 MB); fora do LRU o arquivo cacheado é decodificado |
| `SPEECH_MAX_AUDIO_BYTES` / `SPEECH_MAX_TEXT_CHARS` | `8000000` / `2000` | limites |
| `SPEECH_MAX_CONCURRENCY` / `SPEECH_BUSY_WAIT_SECONDS` | `0` / `60` | inferências simultâneas por engine (`0` = automático: 1 abaixo de 6 CPUs, senão 2) e espera de um pedido `normal` antes de 503 `busy` |
| `SPEECH_LOW_PRIORITY_WAIT_SECONDS` | `20` | espera de um pedido `X-Speech-Priority: low` por um slot antes de 503 `busy` |
| `SPEECH_PRELOAD` | `true` | carrega os modelos no start em thread de fundo (`/healthz` = `warming`); `false` = carrega no primeiro uso |
| `SPEECH_API_TOKEN` | vazio | `Authorization: Bearer …` exigido em `/v1/*` quando definido |
| `SPEECH_LOG_LEVEL` | `INFO` | nível de log |
| `HF_HOME` | `$SPEECH_CACHE_DIR/hf` | cache dos modelos (Hugging Face) |

## Testes

```bash
cd speech && uv run pytest      # 100 testes, ~20 s (engines fake; não baixam modelos)
```

Os testes de API usam `SPEECH_TTS_ENGINE=fake SPEECH_ASR_ENGINE=fake` e `SPEECH_PHONEME_ENGINE=none|fake`. O ASR fake lê a "transcrição" do próprio upload:
bytes UTF-8 começando com `FAKE:` (tokens podem levar `@prob`, ex.: `FAKE:security awareness@0.3 training`, e `#letras` com o que a engine de fonemas fake "ouve", ex.: `threat#tret`; `...` é uma pausa de 1,2 s); qualquer outro conteúdo é "ouvido" igual ao texto de referência. A engine de fonemas fake usa letras como fonemas e monta posteriors sintéticas a partir das palavras ouvidas. O alinhamento CTC, o GOP e a prosódia são testados com matrizes de posteriors montadas à mão e senoides sintéticas; o teste de tokenização com o `espeak-ng` real é pulado se o binário não existir.

Incremento 3 (`tests/test_sentences.py`, `tests/test_runtime.py`, `tests/test_stream.py`): paridade da divisão de frases com a regex do corpus, junção de fragmentos curtos, teto de 400 caracteres, ida e volta dos offsets; palavras das frases × palavras do bloco (deslocadas pelas durações) e bloco sem nenhuma síntese quando as frases estão em cache; stream (ordem das linhas, `cached=true` na segunda chamada, linha `error` depois de `meta`, parada quando o cliente desconecta — o gerador recebe um `is_disconnected` falso); fila de prioridade (`low` espera enquanto há `normal` na fila, `normal` nunca espera por `low`, `low` expira → 503 `busy` via `httpx.ASGITransport` com um TTS fake lento); `effective_cpus` com arquivos de cgroup falsos (v2, v1, afinidade, `cpu_count`); defaults automáticos (3 CPUs → concorrência 1 e 3 threads; 8 → concorrência 2 e paralelo); caminho paralelo de fonemas idêntico ao sequencial (engine fake com script que não depende do ASR) e bloco `runtime` do `/healthz`.

## Calibração

`scripts/calibrate.py` fala com um serviço rodando (nativo ou Docker) por HTTP:

```bash
# casos sintéticos: ~30 frases de segurança × 5 variantes (exata, palavra omitida, trocada, inserida, "pronúncia errada" por grafia) × vozes
uv run python scripts/calibrate.py --synthetic --base-url http://127.0.0.1:8100 --out relatorio.md
# gravações rotuladas por humanos: DIR/<nome>.wav|webm + DIR/<nome>.json {"reference_text", "labels": [{"index", "status"}]}
uv run python scripts/calibrate.py --dataset ./gravacoes --token "$SPEECH_API_TOKEN" --out relatorio.md
```

O relatório (Markdown) traz matriz de confusão, precisão/revocação/F1 por status, notas por variante e varreduras simuladas de `SPEECH_PHONEME_WORD_THRESHOLD` e da confiança de `weak`. Resultado da última rodada: `docs/reading/CALIBRACAO.md`.

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

### Incremento 2: com a engine de fonemas (mesma máquina, 2026-10-12)

Servidor nativo, Kokoro + faster-whisper `small.en` int8 + wav2vec2 `lv-60-espeak-cv-ft` (fp32, 4 threads), clipes MP3 do próprio Kokoro (`af_heart`), 4 avaliações por clipe (1ª e mediana das 3 seguintes):

| Métrica | sem fonemas (`SPEECH_PHONEME_ENGINE=none`) | com wav2vec2 |
|---|---:|---:|
| RSS após carregar os modelos | 1,96 GB | **3,18 GB** (+1,2 GB) |
| RSS depois das avaliações (pico observado) | 2,4 GB | **4,1 GB** |
| Assess, clipe de 14,6 s (30 palavras) — 1ª / regime | 1,79 s / 1,50 s | 2,87 s / **2,23 s** |
| Assess, clipe de 37,5 s (89 palavras, 2 blocos do wav2vec2) — 1ª / regime | 3,75 s / 3,73 s | 6,52 s / **5,84 s** |
| Forward do wav2vec2 (média nos 8 assess, `speech_inference_seconds{engine="wav2vec2"}`) | — | 1,43 s |
| Start com modelos em cache até `phoneme.ready` | 24 s (`status: ok`) | 27 s |
| Download do wav2vec2 na primeira vez | — | 1,26 GB, ~85 s |

Memória: com a engine de fonemas o processo chega a ~4,1 GB; o `APP_SPEECH_MEMORY=6g` do contrato 2 §2.7 dá folga. Sem ela, 4g bastam.

Exemplo real (TTS de "Every **tret** must be reported…" avaliado contra "Every **threat** must…", voz `af_heart`): o Whisper transcreveu `threat` (confiança 0,68), mas a palavra saiu `mispronounced` com `reason: "phoneme"`:

```json
{"text": "threat", "status": "mispronounced", "reason": "phoneme", "heard": "threat", "confidence": 0.677,
 "expected_ipa": "θɹˈɛt", "heard_ipa": "tɹæk", "phoneme_score": 0.524,
 "phonemes": [{"ipa": "θ", "score": 0.001, "heard": "t", "quality": "bad"}, {"ipa": "ɹ", "score": 1.0, "heard": "ɹ", "quality": "good"},
              {"ipa": "ɛ", "score": 0.442, "heard": "æ", "quality": "bad"}, {"ipa": "t", "score": 0.653, "heard": "k", "quality": "fair"}]}
```

com `tips[0] = {"code": "phoneme_confusion", "expected": "θ", "heard": "t", "examples": ["threat"]}`. Já "**wirtual** private network" (voz `am_michael`) ficou `ok` para o Whisper e para a palavra (`phoneme_score` 0,80 ≥ 0,6), mas o fonema `v` saiu `bad` com `heard: "w"` e virou a primeira dica (`v` × `w`).

### Incremento 3: frases, stream e paralelo (mesma máquina, 2026-10-12)

Servidor nativo, Kokoro + faster-whisper `small.en` int8 + wav2vec2 `lv-60-espeak-cv-ft`, modelos em cache
(`SPEECH_CACHE_DIR` apontando para o cache local), `af_heart`, parágrafos de ~80–90 palavras (5 frases, 34–37 s de áudio).

**TTS: bloco × stream** (4 threads de torch, `SPEECH_PARALLEL_PHONEMES=off`; os números com o automático estão logo abaixo):

| Métrica | Valor |
|---|---|
| `POST /v1/tts` a frio, parágrafo de 77 palavras (33,7 s de áudio) | **6,24 s até o primeiro byte útil** |
| `POST /v1/tts/stream` a frio, parágrafo de 87 palavras (35,1 s de áudio, 5 frases) | **1,06 s até a primeira frase** (`segment` 0, 6,7 s de áudio); 5,87 s até `done` |
| `POST /v1/tts` do mesmo parágrafo depois do stream | 0,32 s, **0 chamadas ao Kokoro** (`speech_inference_seconds_count{engine="kokoro"}` inalterado) |
| `words` do bloco × `words` das frases deslocadas pelas durações | **idênticos** (desvio máximo 0,000 s); `text[char_start:char_end] == text` em 100 % das palavras, nas frases e no bloco |
| soma das durações das frases × duração do bloco | 35,050 s × 35,050 s (diferença 0,0 ms); menor frase 6,72 s (nenhuma abaixo de 0,4 s) |
| stream com tudo em cache | 6 ms até a primeira frase, 14 ms até `done` |
| automático (`torch` 8 threads): bloco a frio 36,3 s de áudio / stream a frio 37,4 s de áudio | 5,10 s / **0,98 s até a primeira frase**, 5,16 s até `done`; bloco depois do stream 0,21 s |

Na VM alvo (3–4 vCPUs, onde o bloco levava 15–25 s) a proporção é a mesma: o leitor começa a ouvir depois de ~1/5 do tempo
do bloco, e o resto chega enquanto a primeira frase toca (cada frase de ~7 s leva ~1,2 s para sintetizar aqui).

**Assess: sequencial × paralelo** (clipes mp3 do próprio Kokoro; 4 avaliações por clipe: 1ª / mediana das 3 seguintes):

| Configuração (`/healthz.runtime`) | clipe 26,6 s (60 palavras) | clipe 42,9 s (103 palavras) |
|---|---:|---:|
| A. `off`, threads 4 / 4 / 4 | 3,92 s / **3,85 s** | 6,78 s / **7,11 s** |
| B. `on`, threads 4 / 4 / 4 | 4,01 s / **3,03 s** (−21 %) | 5,85 s / **5,26 s** (−26 %) |
| F. **automático** nesta máquina (10 CPUs → `on`, asr 4 / torch 8 / phoneme 4, concorrência 2) | 3,28 s / **2,76 s** (−28 %) | 4,95 s / **4,78 s** (−33 %) |
| D. `off`, threads 10 / 10 / 10 (regra literal do contrato, sem paralelo) | 12,74 s / 8,59 s | 15,73 s / 16,23 s |
| E. `off`, threads 8 / 8 / 8 | 5,17 s / 4,77 s | 9,05 s / 8,76 s |
| C. `on`, threads 10 / 10 / 5 (regra literal do contrato, com paralelo) | 6,05 s / 7,22 s | 25,38 s / 16,22 s |

Tempo de inferência isolado no clipe de 26,6 s: faster-whisper 2,1 s com 4 threads, 3,2 s com 8, 7,1 s com 10; wav2vec2 1,4 s
com 4 threads e 1,3 s com 8–10. As notas foram idênticas em todas as configurações (`overall` 0,99 e 0,981), o que confirma que o
caminho paralelo não muda o resultado. Em paralelo, cada forward fica um pouco mais lento (Whisper 2,1 → 2,6 s; wav2vec2 1,4 → 1,7 s)
mas o total cai porque os dois se sobrepõem.

## Limitações conhecidas

- Números lidos de forma diferente da expansão simples (`2024` como "twenty twenty-four") contam como `mispronounced` + `extras`.
- Pausas de fim de frase do Kokoro (> 0,8 s) contam como pausas longas quando se avalia o próprio áudio sintetizado; em leitura humana o efeito é o desejado.
- Sem a engine de fonemas, `tips` usa diff de caracteres do IPA (sem segmentação de fonemas compostos).
- O modelo de fonemas não foi afinado para falantes de português; vogais átonas onde espeak e o modelo divergem geram fonemas `bad` isolados em ~9% das palavras corretas (por isso só a média da palavra rebaixa o status).
- Prosódia básica: sem acento lexical nem entonação de pergunta; a monotonia só foi validada com sinais sintéticos.
