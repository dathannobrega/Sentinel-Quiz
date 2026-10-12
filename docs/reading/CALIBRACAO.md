# Sentinel Reader: calibração da avaliação de leitura (Incremento 2)

> Rodada de 2026-10-12, MacBook Pro M1 Pro (32 GB), serviço `speech/` nativo com engines reais:
> Kokoro-82M (TTS), faster-whisper `small.en` int8 (ASR) e wav2vec2 `facebook/wav2vec2-lv-60-espeak-cv-ft` (fonemas).
> Ferramenta: `speech/scripts/calibrate.py` (ver `speech/README.md`, "Calibração").

## 1. Método

- **Casos sintéticos (`--synthetic`).** 30 frases do domínio de segurança (8–12 palavras). Para cada frase o texto *falado* é uma variante do texto de referência:
  - `exact`: igual à referência (todas as palavras rotuladas `ok`);
  - `drop`: uma palavra omitida (rótulo `missed`);
  - `substitute`: uma palavra trocada por outra real e parecida (`training` → `draining`, `threat` → `treat`; rótulo `mispronounced`);
  - `insert`: a palavra `really` inserida (todas `ok`; espera-se 1 `extra`);
  - `respell`: uma palavra trocada por uma grafia que imita erro de aprendiz (`threat` → `tret`, `virtual` → `wirtual`, `thieves` → `teeves`, `critical` → `creetical`, `authentication` → `otentikayshun`…; rótulo `mispronounced`).
- O texto falado é sintetizado pelo próprio `/v1/tts` em 3 vozes (`af_heart` EUA fem., `am_michael` EUA masc., `bf_emma` Reino Unido fem.), o MP3 é enviado a `/v1/assess` com a referência original e o status de cada palavra é comparado com o rótulo. 30 frases × 5 variantes × 3 vozes = **450 avaliações, 4.200 palavras rotuladas**.
- Tudo passa pelo HTTP do serviço, então a mesma ferramenta mede o contêiner Docker (`--base-url`). O modo `--dataset DIR` faz o mesmo relatório com gravações humanas rotuladas.
- As varreduras de limiar são **simuladas offline** sobre as mesmas respostas: o status é recalculado a partir de `phoneme_score` e `confidence` de cada palavra (sem reprocessar áudio).

## 2. Resultados

### Configuração

- Servidor: `http://127.0.0.1:8100`; engines: TTS `kokoro/hexgrad/Kokoro-82M`, ASR `faster-whisper/small.en`, fonemas `wav2vec2/facebook/wav2vec2-lv-60-espeak-cv-ft`
- Modo: sintético (TTS); casos: 450 (450 avaliados, 0 com erro); vozes: af_heart, am_michael, bf_emma
- Tempo total: 484 s; assess médio 2.13 s

### Matriz de confusão (rótulo × status do serviço)

| rótulo \ previsto | ok | weak | mispronounced | missed | total |
|---|---:|---:|---:|---:|---:|
| **ok** | 3870 | 54 | 6 | 0 | 3930 |
| **mispronounced** | 52 | 12 | 116 | 0 | 180 |
| **missed** | 0 | 0 | 2 | 88 | 90 |

### Precisão / revocação / F1 por status

| status | precisão | revocação | F1 | suporte |
|---|---:|---:|---:|---:|
| ok | 0.987 | 0.985 | 0.986 | 3930 |
| mispronounced | 0.935 | 0.644 | 0.763 | 180 |
| missed | 1.000 | 0.978 | 0.989 | 90 |

`weak` não tem rótulo próprio: 54 palavras corretas saíram `weak` (1.4% das corretas).

### Detecção de erro (binária)

Positivo = rótulo `mispronounced`/`missed`; previsto positivo = status `mispronounced`/`missed` (com e sem `weak`).

| critério | precisão | revocação | F1 |
|---|---:|---:|---:|
| mispronounced+missed | 0.972 | 0.763 | 0.855 |
| + weak | 0.784 | 0.807 | 0.796 |

### Por variante

| variante | casos | overall médio | accuracy média | alvo detectado | como (reason) | extras = 1 |
|---|---:|---:|---:|---:|---|---:|
| exact | 90 | 0.984 | 0.983 | — | — | 0/90 |
| drop | 90 | 0.904 | 0.872 | 88/90 | missed 88, não (mispronounced) 2 | 0/90 |
| substitute | 90 | 0.945 | 0.907 | 86/90 | substitution 86, não (ok) 3, não (weak) 1 | 0/90 |
| insert | 90 | 0.973 | 0.983 | — | — | 90/90 |
| respell | 90 | 0.966 | 0.952 | 30/90 | não (ok) 49, substitution 29, não (weak) 11, phoneme 1 | 15/90 |

### Varredura de `SPEECH_PHONEME_WORD_THRESHOLD` (simulada)

Mesmas avaliações, status recalculado offline a partir de `phoneme_score`. `0` = sem rebaixamento por fonema (equivale a desligar a engine para o status).

| limiar | P(mispronounced) | R(mispronounced) | F1 | corretas marcadas mispronounced | respelling detectado |
|---:|---:|---:|---:|---:|---:|
| 0.00 | 0.935 | 0.639 | 0.759 | 0.2% | 29/90 |
| 0.50 | 0.935 | 0.639 | 0.759 | 0.2% | 29/90 |
| 0.55 | 0.935 | 0.644 | 0.763 | 0.2% | 30/90 |
| 0.60 | 0.935 | 0.644 | 0.763 | 0.2% | 30/90 |
| 0.65 | 0.828 | 0.667 | 0.738 | 0.6% | 34/90 |
| 0.70 | 0.752 | 0.672 | 0.710 | 1.0% | 35/90 |
| 0.75 | 0.709 | 0.678 | 0.693 | 1.2% | 36/90 |
| 0.80 | 0.576 | 0.756 | 0.654 | 2.5% | 48/90 |
| 0.85 | 0.502 | 0.794 | 0.615 | 3.6% | 53/90 |
| 0.90 | 0.355 | 0.844 | 0.500 | 7.0% | 62/90 |

Distribuição de `phoneme_score`:

| grupo | n | p05 | p10 | p25 | mediana | média |
|---|---:|---:|---:|---:|---:|---:|
| palavras corretas | 3930 | 0.87 | 0.94 | 1.00 | 1.00 | 0.98 |
| palavras erradas (troca/respelling) | 180 | 0.41 | 0.50 | 0.67 | 0.78 | 0.76 |

### Varredura da confiança para `weak` (simulada)

| confiança mínima | corretas → weak | erradas com confiança abaixo |
|---:|---:|---:|
| 0.3 | 0.1% | 3.9% |
| 0.4 | 0.2% | 5.6% |
| 0.5 | 0.6% | 7.8% |
| 0.6 | 1.3% | 13.9% |
| 0.7 | 2.8% | 24.4% |
| 0.8 | 5.9% | 33.3% |

### Exemplos: Whisper aceitou, fonemas rejeitaram

| caso | palavra | ouvido (ASR) | phoneme_score | esperado | ouvido (fonemas) | rótulo |
|---|---|---|---:|---|---|---|
| s05-respell-af_heart | threat | threat | 0.52 | `θɹˈɛt` | `tɹæk` | mispronounced |

### Falsos positivos (palavra correta marcada como erro)

| caso | palavra | status | reason | ouvido | phoneme_score |
|---|---|---|---|---|---:|
| s00-drop-bf_emma | teaches | mispronounced | substitution | teachers | 0.84 |
| s02-drop-bf_emma | unauthorized | mispronounced | substitution | are | 0.68 |
| s21-drop-af_heart | the | mispronounced | substitution | they | 1.00 |
| s21-drop-am_michael | the | mispronounced | substitution | they | 1.00 |
| s21-drop-bf_emma | the | mispronounced | substitution | they | 1.00 |
| s23-drop-am_michael | a | mispronounced | substitution | of | 1.00 |

### Análise adicional dos `respell` (mesmos dados)

- Em **25 dos 90** `respell` o Kokoro leu a grafia inventada exatamente como a palavra certa (`trafeek` → `tɹæfɪk`, `urgensee`, `serfiss`, `dyjest`, `responsabeelity`, `beheyvyor`, `eensident`, `analeests`, `wedder`, `exposher`): o `phoneme_score` saiu ≥ 0,99 e não há erro audível. São ruído de rótulo, não falhas do serviço.
- Dos 65 `respell` com pronúncia de fato diferente, o Whisper transcreveu outra palavra em 29 (`substitution`, `reason` correto) e **aceitou a palavra certa em 35** (`ok`/`weak`). Desses 35, **34 têm pelo menos um fonema `bad` com o som trocado certo** (`v→w` em *virtual*, `θ→t` em *thieves*/*threat*, `ɪ→iː` em *critical*, `θ→t` + `ɔː→oʊ` em *authentication*…), que aparecem em `phonemes` e nas `tips`; só 1 (*threat* lido como `tɹæk`, `phoneme_score` 0,52) cruzou o limiar de palavra de 0,6 e virou `mispronounced` com `reason: "phoneme"`.
- Nas palavras corretas, 8,8% têm algum fonema `bad` isolado (quase sempre vogal átona onde espeak e o modelo divergem, ex.: `ɛ→ɪ` em *encrypts*); por isso um fonema ruim sozinho **não** rebaixa a palavra, só a média.

### Ablação do alinhamento (5 frases × 3 vozes lidas corretamente, 231 palavras; experimento de desenvolvimento)

| configuração | `phoneme_score` médio das palavras corretas | corretas < 0,6 | corretas < 0,7 |
|---|---:|---:|---:|
| janela do contrato (±0,08 s por palavra), sem equivalências nem formas fracas | 0,82 | 16,0% | 24,7% |
| janela do contrato + equivalências + formas fracas | 0,88 | 7,8% | 14,3% |
| alinhamento conjunto (±0,5 s), sem equivalências nem formas fracas | 0,93 | 5,6% | 6,5% |
| **alinhamento conjunto + equivalências + formas fracas (implantado)** | **0,99** | **0,0%** | **0,0%** |

A janela de ±0,08 s corta o último fonema sempre que o Whisper fecha a palavra cedo (o `s` de *awareness*, o `ŋ` de *training*); o alinhamento conjunto usa o mesmo Viterbi CTC, mas deixa os fonemas vizinhos delimitarem cada palavra.

## 3. O que isto prova e o que não prova

**Prova:**
- O pipeline inteiro (TTS → MP3 → decodificação → Whisper → alinhamento → fonemas → notas) funciona de ponta a ponta, sem erros, em 450 casos e 3 vozes.
- Omissões são detectadas quase sempre (`missed` R = 0,98, P = 1,00); inserções sempre viram `extras` (90/90); trocas por palavra real viram `mispronounced` + `substitution` em 86/90.
- Leitura correta não é punida: 98,5% das palavras corretas saem `ok`, 1,4% `weak`, 0,15% `mispronounced` (6 palavras, todas erro de transcrição do Whisper, ex.: *the* ouvido como *they*); nenhuma por causa dos fonemas. `overall` médio da leitura exata: 0,98.
- A engine de fonemas acrescenta o que o Whisper esconde: ele "corrige" a pronúncia para a palavra esperada em mais da metade dos erros reais, e o GOP aponta o som trocado em 34 de 35 desses casos.
- Homófonos (*phishing*/*fishing*, *flaw*/*floor* no inglês britânico) deixaram de ser marcados como troca.

**Não prova:**
- **Vozes de TTS não são aprendizes.** O Kokoro é fluente e "nativo": não hesita, não tem sotaque de português, não erra acento lexical e lê grafias inventadas de forma imprevisível (25/90 saíram corretas). Os números de revocação de `mispronounced` (0,64) e a distribuição de `phoneme_score` das palavras erradas valem para *este* tipo de erro sintético, não para falantes de português.
- Não mede prosódia: as vozes do Kokoro nunca são monótonas e não fazem pausas fora de lugar; a nota `prosody` ficou ~1,0 em todos os casos. Monotonia e pausas foram validadas só com sinais sintéticos (testes unitários).
- Não mede ruído de microfone, eco, compressão do navegador (Opus/AAC) nem gravações longas.
- 4.200 palavras de 30 frases: intervalos de confiança largos para as taxas pequenas (0,15% = 6 palavras).

## 4. Limiares recomendados

| Variável | Default | Recomendação | Por quê |
|---|---:|---|---|
| `SPEECH_PHONEME_WORD_THRESHOLD` | **0,6 (mantido)** | manter 0,6; reavaliar 0,7 com gravações humanas | 0,6 tem o melhor F1 de `mispronounced` (0,763) e **zero** palavra correta rebaixada pelos fonemas. 0,7 pegaria mais 5 dos 35 erros "escondidos" ao custo de 0,8% das palavras corretas (≈ 1 alarme falso a cada 4 parágrafos); 0,8 pega metade dos erros escondidos mas marca 2,5% das corretas. Para quem está aprendendo, um alarme falso custa mais que um erro sutil não marcado, que continua visível no fonema `bad`, nas `tips` e na nota (`accuracy` usa o `phoneme_score`). |
| `SPEECH_WEAK_CONFIDENCE` (nova; antes constante 0,6) | **0,6 (mantido)** | manter | 1,3% das palavras corretas viram `weak` e 13,9% das erradas ficam abaixo; 0,5 reduziria `weak` falso para 0,6% mas perde quase metade do sinal (7,8%); 0,7 dobra os falsos. |
| `SPEECH_SCORE_WEIGHTS` | 0,5/0,2/0,15/0,15 | manter | sem dado de prosódia humana para recalibrar. |

**Os defaults não mudaram**: os dados não justificam. O próximo passo é rodar `scripts/calibrate.py --dataset` com 50–100 gravações de alunos brasileiros rotuladas por um professor; se o F1 de `mispronounced` subir com 0,7 sem passar de ~1% de alarmes falsos, trocar o default.

## 5. Como reproduzir

```bash
cd speech
SPEECH_PORT=8100 uv run speech-server &           # ou o contêiner: docker compose up speech
uv run python scripts/calibrate.py --synthetic --base-url http://127.0.0.1:8100 \
  --out ../docs/reading/CALIBRACAO-rodada.md --dump /tmp/calibracao.json
```

A rodada completa leva ~8 min no M1 Pro (450 casos, 2 requisições em paralelo, assess médio 2,1 s).
