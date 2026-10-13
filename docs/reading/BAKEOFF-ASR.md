# Sentinel Reader: bake-off de ASR para a avaliação de leitura (faster-whisper × Parakeet)

> Rodadas de 2026-10-12/13, MacBook Pro M1 Pro (32 GB), `speech/` nativo, CPU, int8.
> Ferramenta: `speech/scripts/asr_bakeoff.py` (em processo, sem servidor). Engines: faster-whisper `small.en` int8 (CTranslate2, default do serviço) × NVIDIA Parakeet TDT 0.6B v2 int8 via sherpa-onnx 1.13.8 (`speech/speech/engines/parakeet_asr.py`, extra opcional `uv sync --extra parakeet`).

## 1. Pergunta e critério

A `CALIBRACAO.md` mostrou a principal fraqueza do Whisper para *esta* tarefa: ele "corrige" a pronúncia errada para a palavra esperada (dos 65 respellings audíveis, aceitou a palavra certa em 35). A hipótese era que um transducer (Parakeet TDT, busca gulosa, sem decoder autoregressivo com modelo de língua forte) escreveria o que ouve. "Melhor para a tarefa", em ordem de prioridade:

1. **pega pronúncia errada** (`respell`: a palavra sai diferente da referência e o alinhamento marca `mispronounced`);
2. **não pune leitura correta** (`exact`: palavras `ok`, poucos falsos positivos);
3. timestamps por palavra utilizáveis (reprodução palavra a palavra, janela do GOP);
4. confiança por palavra (o Whisper dá `probability`; o sherpa-onnx expõe `ys_log_probs` por *piece* na busca gulosa — a engine usa a média das probabilidades dos pieces da palavra, mesma convenção do Whisper);
5. latência em CPU com 4 e 8 threads;
6. WER no vocabulário de segurança.

## 2. Método

- **Mesmos casos sintéticos da calibração**: 30 frases de segurança × 5 variantes (`exact`, `drop`, `substitute`, `insert`, `respell`) × 3 vozes do Kokoro (`af_heart`, `am_michael`, `bf_emma`) = **450 clipes, 4.200 palavras rotuladas**, 4,5 s de áudio em média. O texto falado é sintetizado **uma vez** (MP3 64 kb/s mono, o formato que o serviço cacheia) e os mesmos bytes vão para as duas engines; os tempos de palavra do próprio Kokoro são guardados para medir os timestamps do ASR.
- **Pipeline real, em processo**: cada clipe passa por `SpeechService.assess` (decodificação ffmpeg → ASR → alinhamento → homófonos → notas) com a engine de fonemas desligada nas rodadas 1–2 (isola a contribuição do ASR) e ligada na rodada 3 (o que a produção faz). `SPEECH_WEAK_CONFIDENCE=0,6`, `SPEECH_PHONEME_WORD_THRESHOLD=0,6` (defaults).
- **Latência** = só a chamada `transcribe` (rodadas 1–2) ou o `assess` inteiro (rodada 3), por clipe, com 4 e 8 threads; o primeiro clipe de cada configuração aquece e não conta. **RSS** medido num processo filho novo (antes de carregar, depois de carregar, depois do primeiro clipe): em processo o número é poluído pela memória que o Kokoro/engine anterior ainda devolve.
- **Rodada 1 → rodada 2**: a rodada 1 revelou um defeito da engine nova (abaixo); a rodada 2 é a mesma com a correção. Os números do Whisper são determinísticos e repetiram (latência ±1 %).

## 3. Rodada 2 (fonemas desligados): resultados

### Engines

| engine | modelo | carga | RSS ao carregar | RSS após 1º clipe | timestamps por palavra | confiança por palavra |
|---|---|---:|---:|---:|---|---|
| faster-whisper | `small.en` int8 | 1,9 s | +810 MB | **+915 MB** | sim (4227/4229 com fim > início) | sim (`probability`) |
| parakeet | `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` (660 MB em disco) | 1,1 s | +1083 MB | **+1102 MB** | sim (4219/4219) | sim (`exp(ys_log_probs)` médio por palavra) |

### Prioridade 1 e 2: detecção do erro plantado e falsos positivos

| variante | esperado | faster-whisper | parakeet |
|---|---|---:|---:|
| **respell** | mispronounced | **28/90 (31,1 %)** — `substitution` 28; não: `ok` 55, `weak` 7 | **22/90 (24,4 %)** — `substitution` 22; não: `ok` 68 |
| substitute | mispronounced | 87/90 (96,7 %) | 86/90 (95,6 %) |
| drop | missed | 90/90 | 90/90 |
| insert | 1 `extra` | 90/90 | 90/90 |

`respell` por voz — Whisper: af_heart 9/30, am_michael 11/30, bf_emma 8/30; Parakeet: 7/30, 7/30, 8/30. Detectado por **ambos 19, só Whisper 9, só Parakeet 3, nenhum 59**. (Na calibração, 25 dos 90 respellings foram lidos pelo Kokoro exatamente como a palavra certa, sem erro audível; o teto realista é ~65/90 — as duas engines "corrigem" a maior parte.)

| falsos positivos (palavra rotulada `ok`) | faster-whisper | parakeet |
|---|---:|---:|
| `exact`: corretas → mispronounced/missed | **0/840 (0,0 %)** | **0/840 (0,0 %)** |
| `exact`: corretas → weak | 5/840 (0,6 %) | 0/840 (0,0 %) |
| todas as variantes: corretas → mispronounced/missed | 8/3930 (0,2 %) | 6/3930 (0,2 %) |
| todas as variantes: corretas → weak | 36/3930 (0,9 %) | 9/3930 (0,2 %) |

### Matrizes de confusão (rótulo × status do serviço)

| faster-whisper | ok | weak | mispronounced | missed | total |
|---|---:|---:|---:|---:|---:|
| **ok** | 3886 | 36 | 8 | 0 | 3930 |
| **mispronounced** | 58 | 7 | 115 | 0 | 180 |
| **missed** | 0 | 0 | 0 | 90 | 90 |

| parakeet | ok | weak | mispronounced | missed | total |
|---|---:|---:|---:|---:|---:|
| **ok** | 3915 | 9 | 6 | 0 | 3930 |
| **mispronounced** | 72 | 0 | 108 | 0 | 180 |
| **missed** | 0 | 0 | 0 | 90 | 90 |

| status | P / R / F1 — faster-whisper | P / R / F1 — parakeet |
|---|---|---|
| ok | 0,985 / 0,989 / 0,987 | 0,982 / 0,996 / 0,989 |
| mispronounced | 0,935 / 0,639 / 0,759 | 0,947 / 0,600 / 0,735 |
| missed | 1,000 / 1,000 / 1,000 | 1,000 / 1,000 / 1,000 |
| **erro binário (mispronounced+missed)** | **0,962 / 0,759 / 0,849** | **0,971 / 0,733 / 0,835** |

### Prioridade 3: timestamps (clipes `exact`, palavras `ok`, erro absoluto contra os tempos do Kokoro)

| engine | n | início: média | início: p90 | fim: média | fim: p90 |
|---|---:|---:|---:|---:|---:|
| faster-whisper | 835 | 0,099 s | 0,265 s | 0,145 s | **0,550 s** |
| parakeet | 840 | 0,097 s | **0,170 s** | 0,105 s | **0,200 s** |

O Parakeet (TDT emite uma duração por token) tem fim de palavra bem mais estável; o Whisper erra o fim em > 0,5 s em 10 % das palavras (é por isso que o GOP usa alinhamento conjunto ±0,5 s em vez da janela de ±0,08 s do contrato).

### Prioridade 4: confiança por palavra

| engine | corretas: média | corretas: p10 | corretas < 0,6 | erradas (troca/respelling): média | erradas < 0,6 |
|---|---:|---:|---:|---:|---:|
| faster-whisper | 0,961 | 0,873 | 37/3930 (0,9 %) | 0,838 | **19/180 (10,6 %)** |
| parakeet | 0,992 | 0,981 | 7/3930 (0,2 %) | 0,945 | **3/180 (1,7 %)** |

A confiança do Parakeet existe, mas quase não separa certo de errado (busca gulosa de um transducer é muito "segura" do que emite): o status `weak`/`low_confidence` perde quase todo o sinal.

### Prioridade 5: latência do ASR por clipe (só `transcribe`, clipes de 4,5 s)

| engine | threads | média | mediana | p95 | RTF |
|---|---:|---:|---:|---:|---:|
| faster-whisper | 4 | 0,806 s | 0,804 s | 0,863 s | 0,182 |
| faster-whisper | 8 | 0,814 s | 0,788 s | 0,988 s | 0,184 |
| parakeet | 4 | **0,148 s** | 0,147 s | 0,176 s | **0,033** |
| parakeet | 8 | **0,122 s** | 0,120 s | 0,146 s | 0,027 |

O `small.en` não ganha nada com 8 threads (confirma a regra do `runtime.py`); o Parakeet é **5,4× mais rápido** com 4 threads e ganha 18 % com 8.

### Prioridade 6: WER nos clipes `exact` (840 palavras de vocabulário de segurança)

| engine | erros | WER |
|---|---:|---:|
| faster-whisper | 8 | 0,95 % |
| parakeet | 6 | 0,71 % |

### O que cada engine ouviu (amostra dos `respell`)

| caso | palavra | grafia falada | faster-whisper | parakeet |
|---|---|---|---|---|
| s00 af_heart | Security | Sekyoority | mispronounced: *secaawardy* | mispronounced: *secaurity* |
| s01 af_heart | authentication | otentikayshun | ok: authentication | mispronounced: *otentikeshan* |
| s01 bf_emma | authentication | otentikayshun | ok: authentication | mispronounced: *tikashan* |
| s02 am_michael | firewall | fyerwool | mispronounced: *fire* | ok: firewall |
| s04 af_heart | vulnerability | wulnerabeelity | mispronounced: *ability* | ok: vulnerability |
| s06 af_heart | symbols | seembols | mispronounced: *balls* | ok: symbols |
| s10 af_heart | privilege | preevilej | mispronounced: *village* | ok: privilege |
| s11 af_heart | recovery | reecovairy | weak: recovery | mispronounced: *recavery* |
| s15 bf_emma | database | dahtabahs | mispronounced: *databars* | ok: database |
| s16 af_heart | attachments | atachmense | mispronounced: *adagements* | ok: attachments |
| s25 am_michael | thieves | teeves | weak: thieves | ok: thieves |

O padrão: o Whisper, quando não corrige, escreve *outra palavra real* parecida (`village`, `balls`, `ability`); o Parakeet, quando não corrige, escreve uma grafia fonética (`otentikeshan`, `recavery`) — mais útil no campo `heard` para o aluno —, mas corrige **mais vezes** (68 × 55). A hipótese "transducer não autocorrige" **não se confirmou** para o Parakeet TDT v2: ele foi treinado com pontuação e capitalização e seu prediction network normaliza tanto quanto o Whisper.

### Defeito encontrado e corrigido (rodada 1 → 2)

Na rodada 1 o Parakeet tinha 6/840 falsos positivos nos `exact`, todos na frase 23: ele escreveu `fixed-length` num só token para a referência `fixed length`, e o alinhamento (que só sabe expandir um token da *referência* com hífen) marcou `fixed` como `missed` e `length` como `mispronounced`. A engine agora separa o composto quando o piece entre dois pieces é um hífen (`fixed`, `-`, `length` → `fixed` + `length`; `multi-factor` na referência continua alinhando porque `compare_key` ignora hífens). Resultado na rodada 2: 0/840 falsos positivos nos `exact`, `substitute` 83 → 86/90, precisão de `missed` 0,849 → 1,000. Teste: `tests/test_parakeet_words.py::test_hyphenated_compound_splits_into_two_words`.

## 4. Rodada 3 (fonemas ligados, como em produção)

Mesmos 450 clipes, só as variantes **`exact` e `respell`** (180 clipes, 1.680 palavras), com a engine de fonemas `wav2vec2-lv-60-espeak-cv-ft` ligada — é ela que, em produção, pega a pronúncia errada que o ASR esconde. Qualidade medida na configuração 4 threads/fonemas em sequência; latência do `assess` completo nas quatro configurações (threads = CPUs da máquina simulada; `on` divide o orçamento como o `runtime.py`: fonemas `threads // 2`, ASR o resto), as três restantes num subconjunto de 60 clipes. 11 min no M1 Pro.

### Engines (ASR + fonemas)

| engine | carga ASR | carga fonemas | RSS ao carregar (ASR + wav2vec2) | RSS após 1º assess |
|---|---:|---:|---:|---:|
| faster-whisper `small.en` | 1,8 s | 14,9 s | +2324 MB | **+2558 MB** |
| parakeet | 1,0 s | 15,2 s | +2607 MB | **+2823 MB** |

(+265 MB para o Parakeet; nos dois casos o wav2vec2 fp32 é o que pesa: ~1,6 GB.)

### Detecção e falsos positivos com fonemas

| métrica | faster-whisper | parakeet |
|---|---:|---:|
| **`respell` → `mispronounced` (qualquer `reason`)** | **29/90 (32,2 %)** — `substitution` 28 + `phoneme` 1 | **24/90 (26,7 %)** — `substitution` 22 + `phoneme` 2 |
| `respell`: detectado por ambos / só Whisper / só Parakeet / nenhum | 21 / 8 / 3 / 58 | |
| `exact`: corretas → mispronounced/missed | 0/840 | 0/840 |
| `exact`: corretas → weak | 5/840 (0,6 %) | 0/840 |
| todas as corretas (exact+respell) → mispronounced/missed | 2/1590 (0,1 %) | 0/1590 |
| precisão / revocação / F1 de `mispronounced` | 0,935 / 0,322 / 0,479 | 1,000 / 0,267 / 0,421 |
| confiança: erradas < 0,6 (sinal para `weak`) | 16/90 (17,8 %) | 3/90 (3,3 %) |

O limiar de palavra 0,6 rebaixa pouco (1 e 2 alvos) — como na calibração. O que importa é o **sinal que o GOP produz nos alvos que o ASR aceitou**, e ele é praticamente igual nas duas engines (o wav2vec2 só depende do ASR para as janelas de palavra, e as do Parakeet são melhores):

| `phoneme_score` dos `respell` aceitos pelo ASR (`ok`/`weak`) | faster-whisper (n = 61) | parakeet (n = 66) |
|---|---:|---:|
| média / mediana | 0,88 / 0,89 | 0,87 / 0,89 |
| < 0,7 / < 0,8 / < 0,9 | 4 / 18 / 32 | 7 / 20 / 37 |

Varredura simulada de `SPEECH_PHONEME_WORD_THRESHOLD` (status recalculado offline; "corretas rebaixadas" sobre 1.590 palavras `ok`):

| limiar | respell detectado — whisper | corretas rebaixadas — whisper | respell detectado — parakeet | corretas rebaixadas — parakeet |
|---:|---:|---:|---:|---:|
| 0,6 (default) | 29/90 | 1 (0,1 %) | 24/90 | 0 (0,0 %) |
| 0,7 | 33/90 | 15 (0,9 %) | 31/90 | 14 (0,9 %) |
| 0,8 | 47/90 | 46 (2,9 %) | 44/90 | 45 (2,8 %) |
| 0,9 | 61/90 | 126 (7,9 %) | 61/90 | 125 (7,9 %) |

Ou seja: a diferença de 5 detecções no status (29 × 24) vem só do ASR; a partir de 0,7 ela cai para 2–3 e em 0,9 desaparece, com a **mesma** taxa de alarmes falsos. Os fonemas `bad` e as `tips` (que não dependem do status) saem iguais para as duas engines.

### Latência do `assess` completo (decodificação + ASR + alinhamento + wav2vec2 + notas; clipes de 4,5 s)

| engine | threads (CPUs) | fonemas em paralelo | n | média | mediana | p95 | RTF | só o ASR |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| faster-whisper | 4 | off | 180 | **1,229 s** | 1,155 s | 1,494 s | 0,278 | 0,809 s |
| faster-whisper | 4 | on (2+2) | 60 | 1,361 s | 1,357 s | 1,453 s | 0,304 | 1,249 s |
| faster-whisper | 8 | off | 60 | 1,180 s | 1,134 s | 1,406 s | 0,262 | 0,823 s |
| faster-whisper | 8 | on (4+4) | 60 | **0,990 s** | 0,985 s | 1,051 s | 0,222 | 0,875 s |
| parakeet | 4 | off | 180 | **0,530 s** | 0,506 s | 0,792 s | 0,119 | 0,147 s |
| parakeet | 4 | on (2+2) | 60 | 0,412 s | 0,404 s | 0,493 s | 0,091 | 0,229 s |
| parakeet | 8 | off | 60 | 0,498 s | 0,490 s | 0,585 s | 0,111 | 0,127 s |
| parakeet | 8 | on (4+4) | 60 | **0,400 s** | 0,387 s | 0,481 s | 0,089 | 0,169 s |

Leituras:
- Com fonemas, a vantagem do Parakeet cai de 5,4× (só ASR) para **2,3–2,5×** no `assess` (0,53 × 1,23 s a 4 threads; 0,40 × 0,99 s a 8): o wav2vec2 (~0,4 s) passa a dominar.
- Com 4 CPUs o paralelo **piora** o Whisper (1,36 × 1,23 s: dois pools de 2 threads disputando 4 núcleos — o Whisper sozinho vai a 1,25 s) e melhora o Parakeet (0,41 × 0,53 s: o ASR é tão leve que cabe ao lado do wav2vec2). A regra atual do `runtime.py` (paralelo só com 6+ CPUs) está certa para o Whisper e conservadora para o Parakeet.
- Com 8 CPUs o paralelo ajuda os dois (−16 % Whisper, −20 % Parakeet), como medido no Incremento 3.


## 5. Recomendação

**Manter o faster-whisper `small.en` como default.** O Parakeet TDT 0.6B v2 **não** é melhor na prioridade 1 — detecta *menos* pronúncias erradas pelo status (22 × 28 sem fonemas; 24 × 29 com fonemas) porque normaliza a grafia tanto quanto o Whisper — e sua confiança por palavra quase não separa certo de errado (3 % × 18 % das erradas abaixo de 0,6), o que esvazia o status `weak`. Ganha com folga em latência (5,4× no ASR, 2,3–2,5× no `assess` com fonemas), em timestamps (fim de palavra p90 0,20 s × 0,55 s), um pouco em WER (0,71 % × 0,95 %) e em falsos positivos `weak` (0 × 5/840), e perde 265 MB de RAM. Com a engine de fonemas ligada o déficit de detecção fica pequeno (2–3 alvos em 90 a partir do limiar 0,7; zero em 0,9) e o GOP/`tips` saem iguais — por isso o Parakeet fica **disponível como opção de implantação**, não como default: `uv sync --extra parakeet` + `SPEECH_ASR_ENGINE=parakeet`, sem mudar código.

| VM | Recomendação | Por quê |
|---|---|---|
| **4 vCPU** (ex.: 4 GB–8 GB) | **Whisper `small.en`**, `SPEECH_PARALLEL_PHONEMES=auto` (= `off` com 4 CPUs), concorrência 1 (automático). `assess` ≈ 1,2 s por clipe de 4,5 s no M1; numa VM x86 contar ~2× isso. **Se a fila de avaliações encher** (turma lendo ao mesmo tempo, ou SLO de < 1 s), trocar para `SPEECH_ASR_ENGINE=parakeet` com `SPEECH_PARALLEL_PHONEMES=on`: `assess` 0,41 s (3× mais vazão) ao custo de ~5 % a menos de pronúncias erradas marcadas pelo status (as `tips` de fonema continuam) e +265 MB. Memória: Kokoro + Whisper + wav2vec2 ≈ 2,6 GB de modelos (+ ~0,3 GB de processo) — o limite de 4 GB do compose é apertado mas cabe; com Parakeet, prever 4,5 GB. | O paralelo piora o Whisper com 4 CPUs; o ASR é 2/3 do tempo do `assess` só com o Whisper. |
| **8 vCPU / 8 GB** | **Whisper `small.en`** com o automático do `runtime.py` (8 CPUs → paralelo `on`, asr 4 / phoneme 4, concorrência 2): `assess` ≈ 1,0 s. 8 GB acomodam com folga os três modelos (≈ 3 GB) e duas inferências simultâneas. Parakeet aqui só se a latência percebida for requisito de produto (0,40 s, −60 %): não há ganho de qualidade que justifique a troca por si só. | Com 8 threads o `small.en` não acelera (0,81 × 0,81 s); o que ajuda é o paralelo dos fonemas, já automático. |

Dois ajustes que os dados sugerem, independentes da engine: (1) reavaliar `SPEECH_PHONEME_WORD_THRESHOLD=0,7` com gravações humanas (pega +4/+7 respellings a 0,9 % de rebaixamentos nas duas engines — mesma conclusão da `CALIBRACAO.md`); (2) se o Parakeet for adotado em alguma implantação, a regra de paralelo do `runtime.py` poderia ligá-lo a partir de 4 CPUs para essa engine (0,41 × 0,53 s), e `SPEECH_WEAK_CONFIDENCE` perde função (a confiança do Parakeet raramente fica abaixo de 0,6).

Caveat que vale para toda a comparação: **vozes de TTS não são aprendizes** (§6). O que a rodada mede é a tendência de cada ASR a "corrigir" grafias fonéticas lidas por um locutor nativo e fluente; com sotaque de português, hesitação e acento lexical errado as duas engines podem se comportar diferente — o passo seguinte continua sendo `scripts/calibrate.py --dataset` com 50–100 gravações de alunos rotuladas por um professor, e o `asr_bakeoff.py` pode ser repetido sobre esse dataset com a mesma métrica.


## 6. O que isto prova e o que não prova

- **Vozes de TTS não são aprendizes.** O Kokoro é fluente e nativo; lê grafias inventadas de forma imprevisível (25/90 saíram iguais à palavra certa) e nunca hesita. As taxas de detecção de `respell` valem para este tipo de erro sintético, não para falantes de português; a *comparação* entre engines é justa (mesmos bytes), mas o nível absoluto não é o de produção.
- 4.200 palavras de 30 frases: as taxas pequenas (0,2 % = 6–8 palavras) têm intervalo de confiança largo; a diferença 28 × 22 em `respell` (6 clipes) também é pequena — o que é robusto é que o Parakeet **não** detecta mais, não que detecte muito menos.
- Latência medida num M1 Pro (núcleos de desempenho); numa VM x86 os valores absolutos mudam, a razão entre as engines (~5×) deve se manter, pois ambas rodam int8 em CPU.
- Não mede ruído de microfone, Opus/AAC do navegador, gravações longas, nem prosódia.

## 7. Como reproduzir

```bash
cd speech && uv sync --extra parakeet
export B=/caminho/com/espaco HF_HOME=$B/hf        # Kokoro 330 MB + small.en 480 MB + Parakeet 660 MB (+ wav2vec2 1,2 GB na rodada 3)
uv run python scripts/asr_bakeoff.py --bakeoff-dir $B --threads 4,8 --out bakeoff.md --dump bakeoff.json
uv run python scripts/asr_bakeoff.py --bakeoff-dir $B --variants exact,respell --phoneme wav2vec2 --parallel off,on \
  --threads 4,8 --latency-subset 60 --out bakeoff-fonemas.md
```

O modelo Parakeet baixa sozinho de `github.com/k2-fsa/sherpa-onnx/releases` para `$HF_HOME/sherpa-onnx/` no primeiro uso (ou aponte `--parakeet-model`/`SPEECH_ASR_MODEL` para um diretório). Rodada 2 completa: 23 min no M1 Pro (8 min de síntese + 15 min de ASR); rodada 3: ~20 min.
