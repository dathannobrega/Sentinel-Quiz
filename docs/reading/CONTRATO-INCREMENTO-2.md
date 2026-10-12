# Sentinel Reader: contrato do Incremento 2 (pronúncia por fonema, prática, vocabulário, compreensão e offline)

> Complementa o [contrato do Incremento 1](./CONTRATO-INCREMENTO-1.md); tudo que não é citado aqui continua valendo.
> Este incremento junta os itens 2, 3 e 4 do roadmap original do [plano](./PLANO.md) §14.
> Fonte da verdade: `speech/`, `backend/app/{api,services}/reading*.py`, `web/features/reading/`, e os testes de cada camada.

## 1. Escopo

| Entra | Fica para depois |
|---|---|
| **Correção:** imagem `speech` sobe sem baixar nada além dos pesos (modelo do spaCy embutido); threads do torch configuráveis (`SPEECH_TORCH_THREADS`) | — |
| **Nota por fonema (GOP)** com wav2vec2 fonético: fonemas esperados × ouvidos, nota por fonema e por palavra, "ok" do Whisper rebaixado quando a pronúncia é ruim | Modelo fonético afinado para falantes de português |
| **Prosódia básica:** monotonia (faixa de pitch), pausas inesperadas e pausas que faltam; nota `prosody` | Acento lexical e entonação de pergunta |
| **Fluência corrigida:** pausas depois de pontuação não contam como "longas"; final `'s`/plural não vira troca | — |
| **Treino frase a frase (drill)** | Pontuação adaptativa por usuário |
| **Palavras (SRS):** palavras com problema entram sozinhas num baralho de revisão espaçada; revisão por pronúncia (gravar) ou por significado (cartão) | Importar/exportar Anki |
| **Glossário:** tocar numa palavra mostra IPA, áudio, tradução pt-BR, definição e explicação no contexto (IA, com cache) e adiciona ao baralho | Dicionário offline |
| **Compreensão:** 3 perguntas por seção geradas por IA com evidência literal do texto, corrigidas no servidor | Perguntas abertas com correção por IA |
| **Seus dados:** exportar e apagar tudo da Leitura | — |
| **Offline (PWA):** baixar capítulos (texto + áudio) e ouvi-los sem rede em `/read/offline`; MediaSession (tela bloqueada); timer de sono | Livro inteiro offline; download em segundo plano (Background Fetch) |
| **Operação:** métricas Prometheus no `speech`, testes do `speech` no CI, E2E Playwright da Leitura, ferramenta de calibração | Painel no `/admin` |
| "Ouvir esta seção" no feedback das questões ("Onde revisar") | — |

## 2. Serviço de voz (`speech/`)

### 2.1 Correções
- `en-core-web-sm` 3.8.0 é dependência fixa (wheel oficial do spaCy); o build da imagem falha se `misaki.en` não importar.
- `SPEECH_TORCH_THREADS` (default 4; `0` = todos os núcleos) chama `torch.set_num_threads` antes de carregar o Kokoro. O `OMP_NUM_THREADS` fixo saiu do Dockerfile.

### 2.2 Engine de fonemas
| Variável | Default | Descrição |
|---|---|---|
| `SPEECH_PHONEME_ENGINE` | `wav2vec2` | `wav2vec2` \| `fake` \| `none` |
| `SPEECH_PHONEME_MODEL` | `facebook/wav2vec2-lv-60-espeak-cv-ft` | CTC sobre fonemas IPA do espeak (licença conferida no model card; se não for permissiva, usar `facebook/wav2vec2-xlsr-53-espeak-cv-ft`) |
| `SPEECH_PHONEME_THREADS` | `4` | threads do torch nesta inferência |
| `SPEECH_PHONEME_WORD_THRESHOLD` | `0.6` | abaixo disso uma palavra `ok`/`weak` vira `mispronounced` com `reason: "phoneme"` |

- **Fonemas esperados:** `espeak-ng -q --ipa=3 -v en-us` (binário externo) por palavra, quebrados nos tokens do vocabulário do modelo por *longest match*.
- **GOP:** para cada palavra com `start`/`end`, janela `[start − 0,08 s, end + 0,08 s]`; alinhamento forçado CTC (Viterbi em numpy) dos fonemas esperados; por fonema, `gop = média(log P(esperado) − max_q log P(q))` nos frames alinhados; `score = exp(gop)` ∈ (0, 1]; `heard` = fonema não-branco mais provável no trecho; `quality` = `good` (≥ 0,75), `fair` (≥ 0,5), `bad`.
- `phoneme_score` da palavra = média dos `score` dos seus fonemas.
- Com a engine ativa, `expected_ipa`/`heard_ipa` passam a ser a junção dos fonemas do espeak (esperados/ouvidos). Sem ela, continuam do misaki, **convertidos para IPA padrão** (`A→eɪ`, `I→aɪ`, `W→aʊ`, `Y→ɔɪ`, `O→oʊ`, `Q→əʊ`, `T→ɾ`, etc.).

### 2.3 Prosódia
- F0 por autocorrelação (numpy, hop 10 ms, 75–400 Hz, só frames com voz). `pitch_range_semitones` = desvio-padrão do F0 em semitons; `monotone` = desvio < 2,0.
- Por palavra, `break`: `"unexpected"` se o intervalo antes dela passa de 0,5 s e a palavra anterior não termina em `, . ; : ! ?`; `"missing"` na palavra que termina em `. ! ?` quando a próxima começa menos de 0,12 s depois.
- `prosody.score = clamp(1 − 0,1·unexpected − 0,05·missing − (0,3 se monotone), 0, 1)`; `null` quando a gravação tem menos de 3 palavras ouvidas.

### 2.4 Notas (substitui contrato 1 §4.7)
- `word_acc`: `missed` → 0; `mispronounced` por `substitution` → 0,25; demais → `phoneme_score` com a engine de fonemas, senão `ok` 1 / `weak` 0,5 / `mispronounced` 0.
- `accuracy` = média de `word_acc`; `completeness` igual ao Inc. 1.
- `fluency`: igual ao Inc. 1, mas pausa longa só conta se a palavra anterior **não** termina em pontuação.
- `overall` = pesos `SPEECH_SCORE_WEIGHTS` (default `0.5,0.2,0.15,0.15` para accuracy, completeness, fluency, prosody); sem prosódia, o peso dela é redistribuído proporcionalmente.
- Normalização: `organization's`/`organizations` contra `organization` é `weak` com `reason: "ending"` (não troca).

### 2.5 Resposta de `/v1/assess` (campos novos)

```json
{"words": [{"index": 0, "text": "Security", "char_start": 0, "char_end": 8,
            "status": "mispronounced", "reason": "phoneme", "heard": "security", "confidence": 0.93,
            "start": 0.10, "end": 0.52, "expected_ipa": "sɪkjˈʊɹᵻɾi", "heard_ipa": "sɪkjʊɹɪti",
            "phoneme_score": 0.54,
            "phonemes": [{"ipa": "s", "score": 0.95, "heard": "s", "quality": "good"},
                         {"ipa": "ɪ", "score": 0.41, "heard": "i", "quality": "bad"}],
            "break": null}],
 "scores": {"accuracy": 0.88, "completeness": 0.97, "fluency": 0.82, "prosody": 0.75, "overall": 0.86},
 "prosody": {"score": 0.75, "pitch_range_semitones": 3.4, "monotone": false, "unexpected_breaks": 1, "missing_breaks": 1},
 "engines": {"asr": "faster-whisper", "phoneme": "wav2vec2"},
 "tips": [{"code": "phoneme_confusion", "expected": "θ", "heard": "t", "examples": ["threat", "think"]}]}
```

`reason`: `null` \| `"substitution"` \| `"phoneme"` (mispronounced) \| `"ending"` \| `"low_confidence"` (weak). `phonemes`/`phoneme_score` são `null` sem a engine ou em `missed`. `tips` agora vêm dos fonemas `bad` (esperado × ouvido), até 3.

### 2.6 Endpoints novos
| Rota | Entrada | Saída |
|---|---|---|
| `POST /v1/g2p` | `{"words": ["threat", …] (1–50, ≤ 64 chars), "lang": "en-us"}` | `{"items": [{"word": "threat", "ipa": "θɹˈɛt"}]}` (IPA padrão; `null` se falhar) |
| `GET /metrics` | Bearer quando `SPEECH_API_TOKEN` está definido | Prometheus: `speech_requests_total{route,status}`, `speech_inference_seconds{engine}` (histograma), `speech_tts_cache_hits_total`, `speech_tts_cache_misses_total`, `speech_tts_cache_bytes`, `speech_model_ready{engine}` |

`/healthz` ganha `"phoneme": {"engine", "model", "ready"}`. O status geral só é `ok` quando TTS e ASR estão prontos; a engine de fonemas pode ainda estar `warming` (a avaliação então sai sem fonemas e com `engines.phoneme = null`).

### 2.7 Recursos
wav2vec2 large ≈ 1,3 GB a mais de RAM: `APP_SPEECH_MEMORY` passa a 6g. Novas variáveis no compose: `APP_SPEECH_PHONEME_ENGINE`, `APP_SPEECH_PHONEME_MODEL`, `APP_SPEECH_PHONEME_THREADS`, `APP_SPEECH_TORCH_THREADS`.

## 3. API pública (`/api/reading`)

### 3.1 Seção e drill
- `GET /sections/{id}`: cada bloco ganha `sentences: [{"index": 0, "char_start": 0, "char_end": 124}]` (mesmo separador de frases do corpus; offsets no `text` do bloco).
- `POST /sections/{id}/assess`: campo opcional `sentence_index` (form). Com ele, a referência é só a frase; a resposta traz `sentence_index` e `char_offset` (início da frase no bloco), e `text`/`char_start`/`char_end` das palavras são relativos à frase. `reading_attempt.sentence_index` guarda o valor; `GET …/attempts` o devolve.
- Resposta de `assess` ganha `deck: {"added": 2, "reviewed": 1}` (§3.2).

### 3.2 Palavras (revisão espaçada)
Tabela `reading_word` (§4). Cartões `kind`: `pronunciation` (revisão gravando) e `vocabulary` (revisão por significado).

- **Entrada automática:** após cada avaliação, palavras `mispronounced`, ou `weak` com `phoneme_score < 0,6`, viram cartão `pronunciation` (até 8 por avaliação; se já existe e está vencido, conta como "again"). Palavras do baralho lidas como `ok` (com `phoneme_score ≥ 0,8` quando houver) e vencidas contam como "good".
- **Agenda (SM-2 simplificado):** `again` → `lapses+1`, `reps=0`, vence em 10 min, `ease −0,2` (mín. 1,3); `hard` → intervalo `max(1, i·1,2)` dias, `ease −0,15`; `good` → `reps+1`, intervalo 1, 3, depois `i·ease`; `easy` → `i·ease·1,3`, `ease +0,15`. "Aprendida" = intervalo ≥ 21 dias.

| Método | Rota | Corpo / resposta |
|---|---|---|
| GET | `/words?status=due\|all&kind=pronunciation\|vocabulary&limit=50&offset=0` | `{"items": [card], "total": 40, "due": 7}` (vencidos primeiro) |
| GET | `/words/summary` | `{"total": 40, "due": 7, "learned": 5, "by_kind": {"pronunciation": 30, "vocabulary": 10}}` |
| POST | `/words` | `{"section_id", "part_id", "block_index", "char_start", "char_end", "kind"}` → card (201; 200 se já existia). O servidor expande para a palavra inteira e guarda a frase como `context` |
| DELETE | `/words/{id}` | 204 |
| POST | `/words/{id}/tts` | `{"voice"?, "speed"?}` → mesmo formato do TTS de bloco (texto = a palavra) |
| POST | `/words/{id}/review` | multipart `audio` → `{"assessment": {…}, "grade": "good", "card": card}`; nota: `overall ≥ 0,85` good, `≥ 0,7` hard, senão again |
| POST | `/words/{id}/grade` | `{"grade": "again\|hard\|good\|easy"}` → card (cartões `vocabulary`) |

`card`: `{"id", "word", "kind", "ipa", "meaning_pt", "context", "section_id", "source": "assessment|glossary|manual", "reps", "lapses", "ease", "interval_days", "due_at", "last_score", "last_reviewed_at", "created_at"}`.

### 3.3 Glossário
`POST /glossary` `{"section_id", "part_id", "block_index", "char_start", "char_end"}` →

```json
{"word": "repudiation", "word_norm": "repudiation", "lemma": "repudiation", "part_of_speech": "noun",
 "ipa": "ɹᵻpjˌuːdɪˈeɪʃən", "translation_pt": "repúdio", "definition_en": "…", "context_explanation_pt": "…",
 "examples": ["…"], "source": "ai|cache|none", "in_deck": false, "card_id": null}
```

- O servidor extrai a palavra e a frase do corpus (nunca recebe texto). IPA via `speech /v1/g2p` (ou `null`).
- IA pelo provedor existente (`app.services.ai_authoring.provider.get_provider()`, `AI_PROVIDER=gemini|fake`), tarefa `reading_glossary`, JSON validado; cache em `reading_glossary_entry` por `(word_norm, context_hash)`. Sem IA (`GEMINI_API_KEY` vazio e provedor `gemini`): `source: "none"`, só IPA e áudio.
- Quota `READING_AI_DAILY_QUOTA` (300 chamadas de IA por usuário/dia, somando glossário e compreensão; cache não conta) → 429 `reading_ai_quota_exceeded`. Falha da IA → 502 `reading_ai_failed`.

### 3.4 Compreensão
| Método | Rota | Corpo / resposta |
|---|---|---|
| POST | `/sections/{id}/quiz` | gera (ou devolve do cache) `{"quiz_id", "section_id", "source": "ai\|cache", "questions": [{"index", "prompt", "options": [{"key": "A", "text"}]}], "answers": [{"question_index", "choice", "correct"}]}` (sem gabarito) |
| POST | `/sections/{id}/quiz/answer` | `{"question_index", "choice"}` → `{"correct", "correct_key", "explanation", "evidence", "answered", "correct_count"}` |

- 3 perguntas, 4 alternativas A–D, uma correta, em inglês; `explanation` em pt-BR. Texto-base: a seção e subseções (até 3.000 palavras).
- Validação: `evidence` tem de ser trecho literal (normalizado) do texto-base, senão a pergunta é descartada; menos de 2 válidas → 502 `quiz_generation_failed`.
- Cache por seção em `reading_section_quiz`; respostas em `reading_quiz_answer` (a última por pergunta vale).
- 404 `reading_ai_disabled` quando não há IA. Mesma quota de §3.3.

### 3.5 Seus dados
- `GET /me/export` → `{"exported_at", "progress": [], "attempts": [{…, "result": {…}}], "words": [], "quiz_answers": []}` (download JSON).
- `DELETE /me` → `{"deleted": {"progress": 1, "attempts": 57, "words": 30, "quiz_answers": 6}}`.

### 3.6 Offline
`GET /books/{slug}/chapters/{file}/offline-manifest` → `{"book", "chapter", "sections": [{"id", "title", "blocks": [{"part_id", "block_index", "words"}]}], "total_blocks", "estimated_audio_mb"}` (≈ 0,45 MB por minuto de áudio a 64 kb/s).

### 3.7 Capacidades e estatísticas
- `capabilities` ganha `"ai": {"available", "reason", "provider"}`, `"phonemes": {"available"}` (da saúde do `speech`), `"words": {"due"}` e `"offline": {"max_chapters"}`.
- `stats` ganha `"words": {"total", "due", "learned"}` e `"quiz": {"answered", "correct"}`.

## 4. Dados (migração `0027_reading_practice`)

```
reading_attempt + sentence_index Integer NULL
reading_word: id · user_id FK CASCADE · word_norm String(64) · display String(64) · kind String(16) (check) · ipa String(128) NULL
  · meaning_pt Text NULL · context String(400) NULL · source String(16) (check) · section_id String(256) NULL · part_id String(256) NULL
  · block_index Integer NULL · reps · lapses Integer · ease Float · interval_days Float · due_at DateTime(tz) · last_score Float NULL
  · last_reviewed_at DateTime(tz) NULL · created_at · updated_at · UNIQUE(user_id, word_norm, kind) · INDEX(user_id, due_at)
reading_glossary_entry: id · word_norm String(64) · context_hash String(64) · model String(64) · payload_json Text · created_at
  · UNIQUE(word_norm, context_hash)
reading_section_quiz: id · section_id String(256) UNIQUE · model String(64) · questions_json Text (com gabarito) · created_at
reading_quiz_answer: id · user_id FK CASCADE · quiz_id FK CASCADE · question_index · choice String(1) · correct Boolean · created_at
  · UNIQUE(user_id, quiz_id, question_index)
reading_ai_call: id · user_id FK CASCADE · kind String(16) · created_at · INDEX(user_id, created_at)
```

## 5. Frontend
- **Resultado:** tocar numa palavra abre o detalhe com os fonemas coloridos (`good`/`fair`/`bad` com texto, não só cor), esperado × ouvido, "ouvir o modelo"; quinto medidor `Prosódia`; avisos de monotonia e de pausas; `reason` em texto ("som diferente", "troca de palavra", "final da palavra", "hesitação").
- **Modos:** Ouvir · Frase a frase (drill) · Shadowing (parágrafo). No drill, a frase atual fica destacada; grava, avalia, avança sozinho com `overall ≥ 0,85` ou oferece seguir após 3 tentativas.
- **Glossário:** interruptor "Toque para traduzir" na barra; com ele ligado (ou com duplo clique / toque longo), a palavra abre o popover (IPA, ouvir, tradução, definição, contexto, "Adicionar às palavras"); sem ele, o clique continua pulando o áudio.
- **Compreensão:** cartão "Teste sua compreensão" no fim da seção (gera, responde, mostra explicação e evidência, placar).
- **Palavras:** `/read/words` com resumo, sessão de revisão (pronúncia: ouvir, gravar, resultado; significado: cartão com 4 botões) e lista com exclusão; contador de vencidas na biblioteca.
- **Seus dados:** na biblioteca, "Exportar" (JSON) e "Apagar meus dados da Leitura" (confirmação).
- **Offline:** em cada capítulo, "Baixar para ouvir offline" (progresso, cancelar, tamanho, remover; até 5 capítulos; `navigator.storage.persist()`); dados em Cache Storage `sentinel-reader-v1`; `/read/offline` lista e toca os capítulos baixados sem rede. O service worker passa a guardar (rede primeiro) a navegação de `/read/offline` e os assets `/_next/static/`, e nada mais.
- **MediaSession** (título, livro, play/pause/próximo/anterior/±10 s, posição) e **timer de sono** (10/20/30/45/60 min ou fim da seção, com fade).
- **"Ouvir esta seção"** no "Onde revisar" das questões.
- **E2E:** `web/e2e/reading.spec.ts` com livro sintético próprio (`web/e2e/fixtures/material/json`), `SPEECH_PROVIDER=fake`, `AI_PROVIDER=fake` e `MediaRecorder` falso.

## 6. Variáveis novas da API
| Variável | Default | Descrição |
|---|---|---|
| `READING_AI_DAILY_QUOTA` | `300` | chamadas de IA (glossário + compreensão) por usuário/dia |
| `READING_MAX_OFFLINE_CHAPTERS` | `5` | informativo, devolvido em `capabilities.offline.max_chapters` |

## 7. Códigos de erro novos

| Código | Status | Quando |
|---|---|---|
| `sentence_not_found` | 404 | `sentence_index` fora do bloco |
| `word_invalid` | 400 | o intervalo não cai numa palavra, ou ela só tem dígitos |
| `word_not_found` | 404 | cartão inexistente ou de outro usuário |
| `reading_ai_disabled` | 404 | sem IA configurada e sem quiz em cache |
| `reading_ai_quota_exceeded` | 429 | quota diária de IA atingida |
| `reading_ai_failed` | 502 | erro do provedor ou JSON inválido no glossário |
| `quiz_generation_failed` | 502 | menos de 2 perguntas passaram na validação |
| `quiz_not_found` / `question_not_found` | 404 | resposta antes de gerar o quiz / índice inexistente |

Notas de implementação: revisões de palavra contam na quota diária de avaliações; `DELETE /me` mantém só as linhas de uso do dia (sem conteúdo), para não zerar a quota de IA; um quiz já em cache continua disponível mesmo com a IA desligada.

## 8. Desvios da implementação (medidos, ver [CALIBRACAO.md](./CALIBRACAO.md))

| Contrato | Implementado | Por quê |
|---|---|---|
| GOP numa janela de ±0,08 s por palavra (§2.2) | Um único alinhamento CTC da gravação inteira, com os fonemas de cada palavra restritos a ±0,5 s dos tempos do Whisper (a janela de ±0,08 s ficou como fallback) | O fim das palavras no Whisper costuma vir 0,1–0,3 s antes; com ±0,08 s, 16 % das palavras **lidas certo** ficavam abaixo de 0,6 |
| `P(esperado)` só do fonema exato | Variantes de sotaque que não são erro contam como esperado (vogais reduzidas ᵻ/ɪ/ə/ɐ, ɔː/ɑː, flap t/ɾ/d, ɚ/ɜː, com/sem r final); os erros típicos de aprendiz (θ/t, ð/d, v/w, ɪ/iː, æ/ɛ) continuam estritos | Idem; com as duas mudanças, 0 % das palavras corretas abaixo de 0,6 (média 0,99) |
| Uma pronúncia esperada por palavra | Forma de citação, forma na frase, formas fracas de palavras funcionais (`a`→ɐ, `the`→ðə/ði) e com/sem r de ligação; vale a melhor | Idem |
| — | Homófonos (phishing/fishing, recognise/recognize) voltam a `ok` | Não são erro de leitura |
| Pausa longa ignorada depois de pontuação | Só a pontuação do **texto de referência** conta (não a do Whisper) | O Whisper põe vírgula onde a pessoa pausou |
| — | `SPEECH_WEAK_CONFIDENCE` (0,6), antes constante; `SPEECH_PHONEME_THREADS` aplicado só durante o forward (sob trava); se a fila de fonemas estourar, a avaliação sai sem fonemas em vez de falhar | Operação |
| `scores.prosody` só com prosódia | Sempre presente (`null` sem prosódia); troca de palavra vale 0,25 mesmo sem a engine de fonemas | Consistência com §2.4 |
