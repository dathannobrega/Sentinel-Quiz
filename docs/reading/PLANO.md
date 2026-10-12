# Sentinel Reader: plano da feature de estudo de livros por voz (ouvir, ler junto e shadowing)

> **Nome de trabalho:** Estudo de Livros. **Nome de produto proposto:** **Sentinel Reader** (na UI, "Leitura"). O código usa o namespace técnico `reading` e o serviço `speech`.
> **Status:** plano aprovado para execução, **Incremento 1 implementado** (ver [INCREMENTO-1](./INCREMENTO-1.md) e o [contrato](./CONTRATO-INCREMENTO-1.md)). **Data de referência:** 12/10/2026. **Idioma:** pt-BR.
> **Base:** os livros já convertidos em JSON (`material/json`, 7 títulos, ~4 milhões de palavras), o corpus normalizado (`backend/app/services/material_corpus.py`), o leitor de seções existente (`/theory?section=`) e a análise de modelos abertos de voz abaixo.
> **Convenções:** **[a verificar]** fato não confirmado em fonte primária; **[estimativa]** número de projeto a validar em medição; **[decisão]** escolha deste plano; **[hipótese]** afirmação de produto ainda sem medição.

---

## Índice

- [0. Sumário executivo](#0-sumário-executivo)
- [1. Como os melhores produtos fazem](#1-como-os-melhores-produtos-fazem)
- [2. Personas e jobs-to-be-done](#2-personas-e-jobs-to-be-done)
- [3. Glossário](#3-glossário)
- [4. Jornadas](#4-jornadas)
- [5. Avaliação de modelos](#5-avaliação-de-modelos)
- [6. Requisitos funcionais](#6-requisitos-funcionais)
- [7. Requisitos não funcionais](#7-requisitos-não-funcionais)
- [8. Arquitetura](#8-arquitetura)
- [9. Modelo de dados](#9-modelo-de-dados)
- [10. Algoritmo de avaliação da leitura](#10-algoritmo-de-avaliação-da-leitura)
- [11. Experiência e acessibilidade](#11-experiência-e-acessibilidade)
- [12. Segurança, privacidade, LGPD e licenciamento](#12-segurança-privacidade-lgpd-e-licenciamento)
- [13. Estratégia de testes](#13-estratégia-de-testes)
- [14. Roadmap por incrementos](#14-roadmap-por-incrementos)
- [15. Riscos e mitigações](#15-riscos-e-mitigações)
- [16. Métricas de sucesso](#16-métricas-de-sucesso)
- [17. Questões em aberto](#17-questões-em-aberto)
- [Apêndice A: dimensionamento no MacBook Pro M1 Pro (32 GB)](#apêndice-a-dimensionamento-no-macbook-pro-m1-pro-32-gb)
- [Apêndice B: fontes](#apêndice-b-fontes)

---

## 0. Sumário executivo

### 0.1 Problema

- O Sentinel Quiz já tem os livros oficiais das certificações em JSON e um leitor de seções ligado às questões ("onde revisar"). Mas ler 500 mil palavras em inglês técnico, sozinho e em silêncio, é lento e cansativo.
- Para quem estuda em inglês como segunda língua, dois ganhos conhecidos da pesquisa em aquisição de linguagem estão fora do produto:
  - **ouvir e ler ao mesmo tempo** (read-along / "immersion reading"): melhora retenção, ritmo e vocabulário [hipótese a confirmar com métricas do produto];
  - **ler em voz alta imitando um modelo** (shadowing) com **correção imediata** de pronúncia e fluência.
- As soluções de mercado que fazem isso bem são fechadas, cobram por minuto ou por caractere e exigem enviar o texto (licenciado) e a voz do usuário para a nuvem.

### 0.2 Proposta

Um modo **Leitura** com três capacidades, todas rodando **localmente** (no Mac do usuário ou no stack Docker), sem nenhum provedor externo:

1. **Biblioteca** dos livros convertidos, por capítulo e seção, com "continuar de onde parei".
2. **Ouvir + ler junto**: TTS neural (Kokoro-82M) por parágrafo, com **timestamps por palavra** nativos do modelo; a palavra falada fica destacada, clicar numa palavra pula para ela, velocidade e voz ajustáveis, avanço automático de parágrafo e seção. Fallback para a voz do navegador quando o serviço de voz está fora.
3. **Shadowing com correção**: o usuário grava a leitura de um parágrafo; o serviço transcreve (faster-whisper), alinha com o texto palavra a palavra e devolve cada palavra como **ok / fraca / pronunciada errado (com o que foi ouvido e o IPA esperado × ouvido) / omitida**, mais inserções, notas de **precisão, completude, fluência e geral**, WPM e pausas, no padrão dos avaliadores comerciais (§1.3).

### 0.3 Decisões principais

| # | Decisão | Por quê |
|---|---|---|
| D1 | **Kokoro-82M** como TTS padrão **[decisão]** | Apache 2.0, 82 M parâmetros, roda em CPU, qualidade competitiva no TTS Arena e, decisivo para read-along, **expõe a duração por token** (timestamps por palavra sem alinhador externo). Nenhum outro modelo da lista do pedido reúne os quatro pontos. |
| D2 | **faster-whisper `small.en` int8** como ASR padrão; `mlx-whisper` opcional no Mac **[decisão]** | MIT, CPU, timestamps e probabilidade por palavra. `small.en` é o equilíbrio entre latência (< 1× tempo real em 4 threads **[estimativa]**) e erro em inglês técnico. |
| D3 | Avaliação em dois níveis: **palavra** no Incremento 1, **fonema (GOP)** no Incremento 2 **[decisão]** | Whisper é um reconhecedor, não um avaliador fonético: ele tende a "corrigir" o que ouve. O nível de palavra já dá omissões, trocas, hesitações e fluência; o nível de fonema exige um modelo acústico de fonemas (wav2vec2) e é um incremento à parte. |
| D4 | Serviço de voz **separado** (`speech`), só na rede interna, com cache de áudio em disco **[decisão]** | Isola torch e os modelos (≈ 2–3 GB) da imagem da API, permite limites de CPU próprios, cache compartilhado entre usuários e troca de engine sem mexer na API. |
| D5 | O texto **nunca** vem do cliente; o áudio gravado **nunca** é persistido **[decisão]** | Licença dos livros e LGPD (voz é dado pessoal). A API resolve o bloco pelo id e só guarda o resultado da avaliação. |
| D6 | Unidade de trabalho = **bloco** (parágrafo normalizado de ~90 palavras) **[decisão]** | Primeiro áudio em < 3 s, gravações curtas (< 60 s), cache granular, pré-busca do próximo bloco. |

### 0.4 O que fica para depois (resumo do roadmap, §14)

Nota por fonema, drill por frase e SRS de palavras difíceis (Inc. 2); glossário e perguntas de compreensão com IA (Inc. 3); áudio offline no PWA e controles de tela bloqueada (Inc. 4); narração expressiva (Chatterbox) e livros em outros idiomas (Inc. 5).

---

## 1. Como os melhores produtos fazem

Levantamento de práticas (não de código) para fixar a barra. Fatos de produto marcados **[a verificar]** quando não lidos na documentação oficial durante este plano.

### 1.1 Ouvir enquanto lê (read-along)

| Produto | Prática que importa aqui |
|---|---|
| **Amazon Kindle + Audible (Immersion Reading / Whispersync for Voice)** | Narração profissional com o texto destacado em sincronia e posição compartilhada entre leitura e escuta. É a referência de experiência: **destaque por palavra ou frase, retomada exata, troca fluida entre modos**. |
| **Speechify** | TTS de qualquer texto com **palavra destacada**, velocidade até 4,5× [a verificar], vozes variadas, atalhos de teclado, player fixo. Mostra que o destaque + velocidade é o núcleo; o resto é polimento. |
| **Microsoft Immersive Reader** | Leitura em voz alta com destaque, espaçamento de linha, foco de linha, fonte e tamanho ajustáveis, sílabas, tradução. Referência de **acessibilidade**: nada depende só de cor. |
| **LingQ / Readlang / Beelinguapp** | Leitura com áudio por frase, clique na palavra para definição, vocabulário em SRS, texto bilíngue. Inspiram o Inc. 3 (glossário, SRS). |
| **Learning Ally / Bookshare** | Audiolivros humanos acessíveis com texto sincronizado; reforçam que **a sincronia tem que ser confiável**, senão o leitor desconfia e desliga. |

**Padrões adotados**: destaque por palavra (não só frase), clique para pular, velocidade 0,75–1,25× (TTS neural degrada acima disso **[hipótese]**), pré-busca do próximo trecho, avanço automático, posição persistida por livro, player fixo com atalhos.

### 1.2 Ler em voz alta com feedback

| Produto | Prática que importa aqui |
|---|---|
| **Microsoft Reading Coach / Reading Progress (Teams)** | O aluno grava a leitura; o sistema marca **erros de pronúncia, omissões, inserções, repetições e autocorreções**, calcula **taxa de acerto** e **palavras corretas por minuto**, e monta uma lista de "palavras para praticar" com pronúncia-modelo. É o análogo mais próximo do shadowing proposto e define o **vocabulário de erros** que usamos (§10). |
| **Google Read Along** | Feedback por palavra **em tempo real** com ASR no dispositivo, tolerante e encorajador, para crianças. Mostra que avaliação **leniente** é melhor para engajamento do que rigor fonético prematuro. |
| **ELSA Speak** | Nota por **fonema** com cores (verde/amarelo/vermelho), IPA e dicas de articulação ("a língua entre os dentes para /θ/"). Referência para o Inc. 2 (GOP). |
| **Duolingo (exercícios de fala)** | Avaliação por palavra, tolerante, com "quase lá". Confirma: no primeiro contato, errar não pode parecer punição. |

### 1.3 Avaliadores de pronúncia (APIs comerciais, usados só como referência de desenho)

| API | Saída |
|---|---|
| **Azure AI Speech, Pronunciation Assessment** | Notas 0–100 de **Accuracy, Fluency, Completeness, Prosody** e **PronScore**; por palavra: `Mispronunciation`, `Omission`, `Insertion`, `UnexpectedBreak`, `MissingBreak`, `Monotone`; por fonema: accuracy. |
| **Speechace** | Notas por frase, palavra, sílaba e fonema; fluência (WPM, pausas), vocabulário, gramática em "spontaneous speech". |
| **SpeechSuper** | Avaliação por palavra/frase/parágrafo, "CEFR level". |

**Padrão adotado**: nossas notas são **accuracy, completeness, fluency e overall** em [0,1] (Inc. 1) e **prosody** fica para o Inc. 2 (exige pitch/energia). Os status de palavra (`ok`, `weak`, `mispronounced`, `missed`, `extras`) mapeiam 1:1 para o vocabulário acima. Nenhuma dessas APIs entra no produto: o texto é licenciado e a voz é dado pessoal.

### 1.4 O que ninguém dos acima faz e nós fazemos

- Ligação direta entre **o parágrafo lido** e **as questões do banco** que dependem dele (já existe `study_links`): ler/ouvir a seção por trás do erro, depois praticar.
- Tudo **local e auditável**: modelos abertos, sem telemetria, sem envio de texto ou voz para terceiros.

---

## 2. Personas e jobs-to-be-done

| Persona | Situação | Job |
|---|---|---|
| **Estudante de certificação (brasileiro, inglês intermediário)** | Estuda 1–2 h por dia; cansa de ler em inglês; quer "aproveitar o trajeto". | "Quero **ouvir o capítulo** enquanto acompanho o texto, voltar na palavra que não entendi e **saber onde parei**." |
| **Mesmo estudante, treinando fala** | Vai apresentar ou entrevistar em inglês; lê bem mas pronuncia inseguro. | "Quero **ler em voz alta e saber na hora** quais palavras saíram erradas, ouvir como é e repetir até ficar bom." |
| **Instrutor** (futuro, Inc. 5) | Dá aula de Security+ para turma. | "Quero passar um trecho para a turma ler e ver quem travou em quê." |

---

## 3. Glossário

| Termo | Definição |
|---|---|
| **Seção** | Unidade do corpus normalizado (`material_corpus`): título, blocos, filhos, `kind` (`teach`, `summary`, `review`, `answers`, `front`). Id `livro:capitulo:ancora`. |
| **Bloco** | Um parágrafo normalizado (~90 palavras) de uma seção ou de uma subseção exibida junto. Identificado por `(part_id, block_index)`. Unidade de TTS e de shadowing. |
| **Read-along** | Ouvir o TTS com a palavra atual destacada no texto. |
| **Shadowing** | Ler em voz alta imitando o modelo; aqui, com gravação e avaliação. |
| **Timestamps por palavra** | `start`/`end` em segundos de cada palavra no áudio sintetizado ou reconhecido. |
| **G2P** | Grapheme-to-phoneme: texto → fonemas (IPA). Usado para `expected_ipa`/`heard_ipa` (misaki). |
| **GOP** | Goodness of Pronunciation: nota por fonema a partir das probabilidades de um modelo acústico (Inc. 2). |
| **WPM** | Palavras por minuto da fala reconhecida. Faixa alvo de leitura em voz alta em inglês: 120–170 **[estimativa, calibrar]**. |

---

## 4. Jornadas

### 4.1 Ouvir e ler junto

1. `/read` → livro (barra de progresso, "Continuar") → capítulo → seção.
2. O leitor abre na posição salva; o primeiro bloco já foi sintetizado em segundo plano (pré-busca).
3. ▶ toca o bloco; a palavra atual fica destacada e a tela acompanha. Clique numa palavra pula para ela. `←`/`→` trocam de bloco, espaço pausa.
4. Fim do bloco → próximo (já em cache). Fim da seção com auto-avançar → próxima seção na ordem de leitura.
5. Posição e minutos ouvidos são salvos a cada mudança de bloco e ao sair da página.

### 4.2 Shadowing

1. Modo Shadowing no player. Opcional: ouvir o bloco uma vez.
2. 🎙 gravar (teto 90 s, contador). Parar → "Avaliando…" (2–8 s em CPU **[estimativa]**).
3. Resultado: texto com cada palavra marcada, legenda, notas (quatro medidores), WPM, pausas, "ouviu: …" e IPA nas palavras erradas, dicas de sons confundidos.
4. Clique na palavra errada → toca o trecho do modelo só daquela palavra. "Tentar de novo" ou próximo bloco. O histórico do bloco mostra a melhor nota.

### 4.3 Degradação

- Serviço de voz fora: aviso discreto; ouvir usa a voz do navegador (destaque por `onboundary`); shadowing desativado com explicação.
- Sem microfone/permissão: mensagem clara com o que fazer; nada quebra.
- Modelos carregando (`warming`): aviso "voz neural aquecendo", fallback enquanto isso.

---

## 5. Avaliação de modelos

### 5.1 Critérios

| Critério | Peso | Motivo |
|---|---|---|
| Licença permissiva para uso em produto | eliminatório | Apache/MIT/BSD; OpenRAIL e CC BY exigem leitura das restrições. |
| Roda em **CPU** com latência aceitável (M1 Pro e containers x86 sem GPU) | alto | O stack não tem GPU; Docker no Mac não passa Metal. |
| **Timestamps por palavra** nativos (TTS) / por palavra com confiança (ASR) | alto | Sem isso não há read-along nem avaliação. |
| Qualidade/naturalidade (TTS) e WER em inglês técnico (ASR) | alto | Vocabulário de segurança: "cryptographic", "SIEM", "nonrepudiation". |
| Tamanho em RAM/disco | médio | Container com limite de 3 GB. |
| Vozes US e UK, controle de velocidade | médio | Variedade reduz fadiga. |
| Maturidade (pip, releases, issues) | médio | Manutenção. |

### 5.2 TTS

| Modelo | Tamanho | Licença | Roda em | Timestamps por palavra | Veredito |
|---|---|---|---|---|---|
| **Kokoro-82M** (hexgrad) | 82 M | Apache 2.0 | CPU ou GPU | **Sim** (durações por token via misaki; `start_ts`/`end_ts`) | **Padrão [decisão]**. Melhor custo-benefício: qualidade próxima do Chatterbox no TTS Arena, ~330 MB, vozes `af_*`/`am_*` (US) e `bf_*`/`bm_*` (UK), velocidade nativa. Precisa de `espeak-ng` só para palavras fora do dicionário. |
| **Chatterbox Turbo** (Resemble) | 350 M | MIT | GPU / Apple MPS | Não (precisa de alinhador) | Candidato a **modo "narração expressiva"** (Inc. 5) em máquinas com GPU/MPS nativo; pesado para CPU em container. |
| **Pocket TTS** (Kyutai) | 100 M | CC BY 4.0 | só CPU | Não | Leve e streaming, mas sem controle de pausa/emoção e sem timestamps; CC BY exige atribuição visível. Reserva. |
| **Supertonic 3** (Supertone) | ~99 M | OpenRAIL-M | CPU (ONNX) | [a verificar] | Muito rápido em CPU; OpenRAIL-M traz restrições de uso que precisam de leitura jurídica. Reavaliar no Inc. 5. |
| **Qwen3-TTS** 0.6B / 1.7B | 0,6–1,7 B | Apache 2.0 | GPU CUDA | [a verificar] | Multilíngue e com "voice design", mas lento em Mac e inviável em CPU. Fora. |
| **Orpheus** 3B | 3 B | Apache 2.0 (base Llama) | GPU | Não | Muito expressivo; pesado. Fora. |
| **Piper** (rhasspy) | 15–60 M | MIT | CPU | Parcial [a verificar] | Qualidade claramente inferior ao Kokoro; só se o Kokoro falhar em alguma plataforma. |
| **Voz do navegador** (`speechSynthesis`) | — | — | cliente | `onboundary` (Chrome/Safari/Edge; Firefox parcial) | **Fallback [decisão]**: zero infra, qualidade variável, sem cache. |
| Nuvem (ElevenLabs, Azure, Google, OpenAI) | — | comercial | nuvem | Sim | **Excluídos**: texto licenciado sairia do servidor; custo por caractere. Poderiam entrar atrás da mesma interface `TTSEngine` se um dia houver autorização. |

### 5.3 ASR e avaliação de pronúncia

| Modelo / técnica | Licença | Roda em | O que dá | Veredito |
|---|---|---|---|---|
| **faster-whisper** (CTranslate2) `small.en` / `base.en` / `medium.en` / `distil-large-v3` / `large-v3-turbo` | MIT (código); pesos Whisper MIT | CPU int8 | Transcrição, **timestamps e probabilidade por palavra**, VAD | **Padrão [decisão]**: `small.en` int8. `base.en` para máquinas fracas; `distil-large-v3` quando houver mais CPU. |
| **mlx-whisper** | MIT | Apple Silicon (GPU via MLX) | Idem, 3–6× mais rápido que CPU no M1 **[estimativa]** | **Opcional no Mac nativo [decisão]** (`SPEECH_ASR_ENGINE=mlx-whisper`). |
| whisper.cpp (+ CoreML) | MIT | CPU/Metal | Idem | Alternativa de borda; não entra agora. |
| NVIDIA Parakeet / Canary (NeMo) | CC BY 4.0 | GPU | WER muito baixo, timestamps | Sem GPU e sem Mac; fora. |
| **wav2vec2 fonético** (`facebook/wav2vec2-lv-60-espeak-cv-ft`, `xlsr-53-espeak`) | [a verificar por checkpoint] | CPU/GPU | Sequência de **fonemas** reconhecidos → comparação com o G2P esperado → **GOP** | **Inc. 2 [decisão]**: é o que transforma "ouvi outra palavra" em "o /θ/ saiu como /t/". |
| Alinhadores forçados (Montreal Forced Aligner, Charsiu, torchaudio `forced_align`) | MIT/Apache | CPU | Fronteiras de palavra/fonema dadas a transcrição conhecida | Inc. 2: alinhar a gravação ao texto esperado e medir duração por fonema. |
| **Limite conhecido do Whisper** | — | — | Como modelo de linguagem forte, **normaliza** pronúncias ruins para a palavra certa (falso "ok") e inventa palavras em silêncio. | Mitigações no Inc. 1 (§10): sem `initial_prompt` com o texto, `temperature=0`, `condition_on_previous_text=False`, VAD, limiar de confiança (`weak`), substituição por similaridade. Expectativa honesta: detecta **omissões, trocas, hesitações e ritmo** bem; **pronúncia fina** fica para o Inc. 2. |

### 5.4 G2P / IPA

**misaki** (dependência do Kokoro, Apache 2.0): dicionário + `espeak-ng` para fora de vocabulário. Gera `expected_ipa` e `heard_ipa`, e as "dicas de sons" (§10.4) por diff de caracteres IPA.

---

## 6. Requisitos funcionais

| ID | Requisito | Inc. |
|---|---|---|
| RF-R01 | Biblioteca com os livros do corpus, capítulos, seções legíveis (`teach`/`summary`, ≥ 20 palavras), palavras e minutos estimados (150 wpm). | 1 |
| RF-R02 | "Continuar de onde parei" por livro, com percentual. | 1 |
| RF-R03 | Leitor de seção com blocos; `previous`/`next` na ordem de leitura. | 1 |
| RF-R04 | TTS por bloco com `words[start,end,char_start,char_end]`; cache por hash do pedido. | 1 |
| RF-R05 | Destaque da palavra atual; clique na palavra → seek; auto-scroll opcional. | 1 |
| RF-R06 | Velocidade 0,75–1,25× (API aceita 0,5–1,5); escolha de voz US/UK. | 1 |
| RF-R07 | Pré-busca do próximo bloco; avanço automático de bloco e de seção. | 1 |
| RF-R08 | Fallback para `speechSynthesis` com destaque por `onboundary`. | 1 |
| RF-R09 | Gravação do bloco (MediaRecorder, teto 90 s, 32 kb/s) e envio; nunca persistida. | 1 |
| RF-R10 | Avaliação por palavra (`ok`/`weak`/`mispronounced`/`missed` + `extras`) com `heard`, confiança, IPA esperado × ouvido. | 1 |
| RF-R11 | Notas `accuracy`, `completeness`, `fluency`, `overall`; WPM; pausas longas; dicas de sons. | 1 |
| RF-R12 | "Ouvir o modelo" por bloco e por palavra (trecho `start–end`). | 1 |
| RF-R13 | Histórico de tentativas por bloco/seção e estatísticas (tentativas, média, melhor, palavras lidas, minutos ouvidos, dias ativos). | 1 |
| RF-R14 | Capacidades (`/capabilities`) refletindo serviço fora/aquecendo/desligado e quota. | 1 |
| RF-R15 | Atalhos de teclado e layout de celular com player fixo. | 1 |
| RF-R16 | Nota por fonema (GOP) e dicas de articulação por som. | 2 |
| RF-R17 | Drill por frase: repetir até atingir um limiar; palavras difíceis entram na fila de revisão (SRS). | 2 |
| RF-R18 | Prosódia (acento de palavra, entonação) e `UnexpectedBreak`/`MissingBreak`. | 2 |
| RF-R19 | Glossário (clique na palavra → definição/tradução pt-BR, cache) e deck de vocabulário. | 3 |
| RF-R20 | Perguntas rápidas de compreensão geradas por IA ao fim da seção (reuso do AI authoring). | 3 |
| RF-R21 | Áudio offline no PWA (Cache Storage por capítulo), MediaSession (controles na tela bloqueada), sleep timer. | 4 |
| RF-R22 | Narração expressiva opcional (Chatterbox em GPU/MPS); livros em pt-BR com vozes `p*` do Kokoro. | 5 |
| RF-R23 | Tarefas de leitura em voz alta para turmas (integração com a Arena). | 5 |

## 7. Requisitos não funcionais

| ID | Requisito | Alvo |
|---|---|---|
| RNF-R01 | Primeiro áudio de um bloco (90 palavras, cache frio, CPU 4 threads) | p95 < 5 s (medido no M1 Pro: 0,135 s por segundo de áudio, ~4,5 s para 90 palavras); cache quente < 300 ms (medido: 9 ms) |
| RNF-R02 | Avaliação de gravação de 30 s (`small.en` int8, CPU 4 threads) | p95 < 8 s (medido no M1 Pro: 0,12 s por segundo de áudio, ~3,6 s para 30 s); MLX no Mac < 3 s **[estimativa]** |
| RNF-R03 | RAM do serviço de voz em regime | 2,3 GB medidos (pico 2,9 GB); limite 4 GB |
| RNF-R04 | Disponibilidade: a API nunca falha por causa do speech | degradação por capacidades; timeouts 60 s; 503/504 com código |
| RNF-R05 | Cache de áudio | LRU por tamanho (2 GB), hit rate alvo > 70 % após a primeira semana **[hipótese]** |
| RNF-R06 | Limites | upload 8 MB (nginx 10 MB), bucket `reading` 60/min/IP, quota 400 avaliações/usuário/dia |
| RNF-R07 | Acessibilidade | WCAG 2.2 AA: status nunca só por cor, foco visível, `aria-*` nos controles, `prefers-reduced-motion` |
| RNF-R08 | Compatibilidade | Chrome/Edge/Firefox/Safari atuais; iOS Safari (MediaRecorder `audio/mp4`) |
| RNF-R09 | Observabilidade | logs estruturados com `event`, latência TTS/ASR, `cached`, códigos de erro; métricas Prometheus no Inc. 2 |
| RNF-R10 | Portabilidade | mesmo serviço roda nativo no Mac (uv) e em container linux/amd64 e arm64 |

---

## 8. Arquitetura

```
navegador ──► proxy (nginx) ──► web (Next.js)  /read, /read/[book], /read/s/[sectionId]
                 │ /api/reading/*            (player, gravador, destaque por offset)
                 └──────────────► api (FastAPI)
                                   ├─ material_corpus (texto dos blocos; nada sai além do bloco em leitura)
                                   ├─ reading.py (biblioteca, ordem de leitura, progresso, tentativas, stats)
                                   ├─ speech_client.py (httpx; health 30 s; erros → 503/504 com código)
                                   └─ postgres (reading_progress, reading_attempt)
                                   ──► speech (FastAPI, CPU, rede interna "speech")
                                          ├─ Kokoro-82M (TTS + timestamps) ─► cache LRU em disco (mp3/wav + words.json)
                                          ├─ faster-whisper / mlx-whisper (ASR com palavras e confiança)
                                          ├─ alinhamento (Levenshtein + similaridade) e notas
                                          └─ misaki G2P (IPA)
```

- **Fronteiras**: a API é dona de autenticação, autorização sobre o texto, quotas, persistência. O `speech` é **stateless** exceto pelo cache de áudio sintetizado; não conhece usuários nem livros.
- **Contratos**: público em `CONTRATO-INCREMENTO-1.md` §4; interno §5. Tipos TS espelham a API.
- **Execução**: `docker compose` (serviço `speech`, volume `speech_cache`, limites `APP_SPEECH_CPUS/MEMORY`) ou nativo no Mac (`uv run speech-server`).
- **Cold start**: pesos baixados no primeiro start para o volume; `/healthz` responde `warming` e a UI degrada enquanto isso.
- **Escala**: réplicas do `speech` atrás de um nome DNS do compose; cache por réplica (um cache compartilhado em volume de rede é o passo seguinte). Fila (Redis) só se a concorrência passar de 2–4 avaliações simultâneas **[estimativa]**.

## 9. Modelo de dados

Ver contrato §6. Resumo: `reading_progress` (1 por usuário × livro; posição + totais) e `reading_attempt` (1 por gravação avaliada; notas + `result_json` sem áudio). Ambas com `ON DELETE CASCADE` do usuário (direito de exclusão). Migração `0026_reading`.

## 10. Algoritmo de avaliação da leitura

### 10.1 Normalização

Tokens = sequências de letras/dígitos/apóstrofo/hífen; minúsculas; pontuação fora; números inteiros por extenso (`2` → `two`); `&` → `and`, `%` → `percent`. O texto de referência mantém os offsets originais para a UI.

### 10.2 Reconhecimento

faster-whisper: `language=en`, `beam_size=5`, `temperature=0`, `word_timestamps=True`, `condition_on_previous_text=False`, `vad_filter=True`, **sem `initial_prompt`** (passar o texto esperado faria o modelo "enxergar" a palavra certa mesmo quando mal pronunciada).

### 10.3 Alinhamento e status

Levenshtein entre referência e hipótese com custo de substituição `1 − ratio/100` (rapidfuzz): trocas parecidas ("vulnerability" → "vulnerable") viram `mispronounced` com `heard`; deleções → `missed`; inserções → `extras` (ancoradas após a palavra anterior). Palavras alinhadas iguais com probabilidade ≥ 0,6 → `ok`; abaixo → `weak`.

### 10.4 Notas

- `accuracy = (ok + 0,5·weak) / referência`
- `completeness = (referência − missed) / referência`
- `fluency = clamp(1 − 0,5·penalidade_wpm − 0,1·pausas_longas − 0,05·extras, 0, 1)`, onde `penalidade_wpm = 0` em [120, 170] e cresce linearmente até 1 a 60 wpm de distância; pausa longa = intervalo > 0,8 s.
- `overall = 0,6·accuracy + 0,2·completeness + 0,2·fluency`
- **Dicas**: para palavras `mispronounced`, diff de caracteres entre `expected_ipa` e `heard_ipa`; os 3 pares de sons mais frequentes viram `tips` (`{expected: "θ", heard: "t", examples: [...]}`). Calibração dos pesos e limiares é um item do Inc. 2 (com gravações reais e avaliação cega).

### 10.5 Limites declarados

Whisper pode aceitar pronúncia ruim como certa (falso `ok`) e, em silêncio, inventar palavras (`extras`). O VAD e o limiar de confiança reduzem o segundo; o primeiro só melhora com o modelo fonético do Inc. 2. A UI diz "o que o modelo ouviu", não "você errou".

## 11. Experiência e acessibilidade

- Tipografia serifada do leitor existente, 17–18 px, 1,75 de entrelinha; palavra atual com fundo `primary-soft` **e** sublinhado; bloco ativo com borda.
- Player fixo embaixo (acima da tab bar no celular, com `safe-area-inset-bottom`): play/pause, bloco anterior/próximo, velocidade, voz, auto-avançar, modo.
- Resultado do shadowing: cores **com** ícone/texto na legenda; `heard` e IPA visíveis ao tocar (não só em hover).
- Teclado: espaço, `←`/`→`, `R`. Foco visível em tudo. `prefers-reduced-motion` desliga o scroll suave.
- Mensagens de erro em pt-BR e en-US por código (`speech_unavailable`, `audio_too_large`, `reading_quota_exceeded`…).

## 12. Segurança, privacidade, LGPD e licenciamento

| Tema | Regra |
|---|---|
| Acesso | Login obrigatório em toda a API `/api/reading` (livros licenciados). `/read` guardado também no `proxy.ts`. |
| Texto | O cliente nomeia o bloco; a API resolve o texto. Um `part_id` fora da seção é recusado (`block_not_found`). |
| Áudio sintetizado | Derivado de texto licenciado: fica **só** no cache do `speech`, rede interna, LRU, nunca exportado, servido via API autenticada com `Cache-Control: private`. |
| Gravações | Dado pessoal (voz). Processadas em memória e descartadas; só o resultado é gravado. Sem `initial_prompt`, sem logs do áudio. |
| Rede | `speech` sem porta publicada, só na rede `speech`; token compartilhado opcional (`SPEECH_API_TOKEN`). Egress permitido apenas para baixar pesos no primeiro start (Hugging Face). |
| Abuso | Bucket `reading` por IP, quota diária por usuário, teto de upload (API 8 MB, nginx 10 MB), allowlist de `Content-Type`, `audio_id` em hex de 64 caracteres. |
| Navegador | `Permissions-Policy: microphone=(self)`; CSP `media-src 'self' blob:`; blob URLs revogadas. |
| LGPD | Base legal: execução de contrato (funcionalidade pedida pelo usuário). Direitos: exclusão em cascata com a conta; "Meus dados" do Reader (apagar tentativas) no Inc. 2. Transparência: aviso na primeira gravação explicando que a voz é processada localmente e não guardada. |
| Licenças de modelo | Kokoro (Apache 2.0), misaki (Apache 2.0), faster-whisper/CTranslate2 (MIT), pesos Whisper (MIT), torch (BSD), espeak-ng (GPL v3, usado como **binário externo**, não linkado), ffmpeg (LGPL/GPL conforme build, binário externo). Supertonic (OpenRAIL-M) e Pocket TTS (CC BY) só após revisão. |

## 13. Estratégia de testes

| Camada | O que | Onde |
|---|---|---|
| Unidade (speech) | normalização e offsets; alinhamento (perfeito, omissão, troca parecida, inserção, baixa confiança); fórmulas das notas; dicas | `speech/tests/` |
| API (speech) | engines `fake`: TTS com offsets corretos e `cached`, áudio, assess com transcrição `FAKE:`, 413/400/401 | `speech/tests/` |
| API (backend) | biblioteca e ordem de leitura, blocos e autorização do `part_id`, TTS/áudio via cliente fake, assess + persistência + quota + limites, progresso e stats, rate limit, mapeamento de falhas do cliente HTTP | `backend/tests/test_reading_api.py` |
| Migração | `0026` idempotente; schema = modelos (autogenerate sem diffs) | `backend/tests/test_migrations.py` |
| Web | tokenização e mapeamento palavra→token; escolha de MIME do gravador; resultado da avaliação (status, legenda, `heard`); biblioteca com fallback | `web/features/reading/**/*.test.ts(x)` |
| Smoke real | Kokoro + whisper no Mac: offsets batem com o texto, áudio sintetizado avaliado contra o próprio texto ≥ 0,85, texto alterado gera `missed`/`mispronounced`; latências registradas | `speech/README.md` |
| E2E (Inc. 2) | Playwright com `SPEECH_PROVIDER=fake`: ouvir um bloco, gravar com `MediaRecorder` falso, ver resultado | `web/e2e/reading.spec.ts` |
| Calibração (Inc. 2) | 50 gravações reais rotuladas por humanos; precisão/recall por status; ajuste de limiares | `scripts/reading/calibrate.py` |

## 14. Roadmap por incrementos

| Inc. | Escopo | Critério de pronto |
|---|---|---|
| **1 (feito)** | Biblioteca, read-along com Kokoro, fallback do navegador, shadowing por palavra, progresso/stats, serviço `speech`, compose/CI, docs | testes verdes nas três camadas; smoke real no Mac; `docker compose up` com `speech` |
| **2** | GOP por fonema (wav2vec2), prosódia básica, drill por frase, SRS de palavras difíceis, "Meus dados" do Reader, métricas Prometheus, E2E, calibração com gravações reais | precisão/recall por status medidos; latência p95 dentro do alvo |
| **3** | Glossário com tradução pt-BR (cache), deck de vocabulário, perguntas de compreensão por IA ao fim da seção, ligação "ouvir a seção por trás do erro" no feedback das questões | uso do glossário e das perguntas instrumentado |
| **4** | Áudio offline no PWA por capítulo, MediaSession (tela bloqueada), sleep timer, download de capítulo | ouvir um capítulo inteiro no celular em modo avião |
| **5** | Narração expressiva (Chatterbox) opcional, vozes pt-BR (Kokoro `p*`) para materiais em português, tarefas de leitura para turmas (Arena) | um instrutor atribui um trecho e vê o painel da turma |

## 15. Riscos e mitigações

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Whisper aceita pronúncia ruim como certa (falso `ok`) | alta | médio | Linguagem honesta na UI ("o modelo ouviu"); `weak` por confiança; Inc. 2 (GOP) |
| Latência de CPU frustra no shadowing | média | alto | Blocos curtos; `small.en` int8; MLX no Mac; `base.en` como opção; "Avaliando…" com progresso |
| Imagem `speech` grande (torch) e CI lenta | alta | baixo | Imagem separada, cache de camadas no GHA, torch CPU, pesos fora da imagem |
| Cold start de minutos (download de pesos) | alta | médio | Estado `warming` no `/healthz` e nas capacidades; volume persistente; pré-aquecimento documentado |
| Safari/iOS: formatos de gravação (`audio/mp4`) e permissão de microfone no PWA | média | médio | Seleção de MIME em cascata; ffmpeg decodifica qualquer container; mensagens de permissão; testar em iOS 17+ **[a verificar]** |
| Áudio derivado de texto licenciado vazar | baixa | alto | Cache só no `speech`, rede interna, servido autenticado, `private`; nunca em CDN |
| Sincronia do destaque "escorrega" (offsets errados) | média | alto | Offsets calculados no serviço a partir do texto exato sintetizado; teste `text[char_start:char_end] == word`; interpolação de tokens sem timestamp |
| Vocabulário técnico fora do dicionário do G2P | média | baixo | `espeak-ng` como fallback; lista de pronúncias próprias (Inc. 2) |
| Fonte única de verdade do corpus muda (reconversão de livro) | baixa | médio | Ids estáveis `livro:capitulo:ancora`; progresso aponta para seção, com fallback para o início do capítulo se o id sumir (Inc. 2) |

## 16. Métricas de sucesso

| Métrica | Definição | Alvo inicial **[hipótese]** |
|---|---|---|
| Ativação | usuários com ≥ 1 bloco ouvido na semana / usuários ativos | 30 % |
| Minutos ouvidos por usuário ativo/semana | `seconds_listened` | 40 min |
| Blocos shadowed por usuário ativo/semana | `reading_attempt` | 10 |
| Evolução | média de `overall` nas últimas 20 tentativas − primeiras 20 | +0,10 em 4 semanas |
| Retomada | sessões que começam por "Continuar" | 60 % |
| Técnicas | cache hit TTS, p95 TTS/ASR, taxa de 503/504, taxa de fallback do navegador | > 70 %, < 3 s / < 8 s, < 1 %, < 5 % |

Instrumentação: tabelas existentes + logs estruturados; painel no `/admin` no Inc. 2.

## 17. Questões em aberto

| # | Questão | Dono | Prazo |
|---|---|---|---|
| Q-R1 | Faixa de WPM alvo e pesos das notas: calibrar com gravações reais ou manter Azure-like? | produto + dados | Inc. 2 |
| Q-R2 | Expor o resultado do shadowing para instrutores (turmas) exige consentimento adicional? | jurídico | Inc. 5 |
| Q-R3 | Guardar a gravação **opcionalmente** (opt-in) para o usuário se ouvir depois? | produto | Inc. 2 |
| Q-R4 | Supertonic 3 (OpenRAIL-M) e Pocket TTS (CC BY) podem entrar como engines alternativas? | jurídico | Inc. 5 |
| Q-R5 | Reconverter o CEH v13 (PDF) para liberar o livro no Reader (hoje excluído do corpus). | conteúdo | Inc. 3 |

---

## Apêndice A: dimensionamento no MacBook Pro M1 Pro (32 GB)

| Componente | RAM **[estimativa]** | Observações |
|---|---|---|
| torch CPU + Kokoro-82M | ~0,8 GB | fp32; medido 7× tempo real em CPU (0,135 s/s); MPS não é usado no container |
| faster-whisper `small.en` int8 | ~0,6 GB | medido 8× tempo real com 4 threads (0,12 s/s) |
| mlx-whisper `small.en` (nativo) | ~0,5 GB | 3–6× mais rápido que CPU |
| Serviço FastAPI | ~0,2 GB | |
| **Total container `speech`** | **2,3 GB medidos (pico 2,9 GB)** | limite 4 GB; `APP_SPEECH_CPUS=4` dos 8 núcleos de performance |
| Stack completo (postgres, redis, api, web, proxy, speech) | ~4 GB | confortável em 32 GB |

Modelos em disco (volume `speech_cache`): Kokoro ~330 MB + vozes ~30 MB; whisper `small.en` ~480 MB; cache de áudio até 2 GB.

## Apêndice B: fontes

- Kokoro-82M (model card, licença Apache 2.0; pipeline com `start_ts`/`end_ts` por token): https://huggingface.co/hexgrad/Kokoro-82M · https://github.com/hexgrad/kokoro
- misaki (G2P): https://github.com/hexgrad/misaki
- faster-whisper / CTranslate2 (MIT; `word_timestamps`, `vad_filter`): https://github.com/SYSTRAN/faster-whisper
- mlx-whisper: https://github.com/ml-explore/mlx-examples/tree/main/whisper
- Chatterbox (Resemble AI, MIT): https://github.com/resemble-ai/chatterbox
- Pocket TTS (Kyutai): https://github.com/kyutai-labs/pocket-tts [a verificar]
- Supertonic (Supertone): https://github.com/supertone-inc/supertonic [a verificar]
- Qwen3-TTS: https://github.com/QwenLM/Qwen3-TTS [a verificar]
- Orpheus TTS (Canopy Labs): https://github.com/canopyai/Orpheus-TTS
- Azure AI Speech, Pronunciation Assessment (vocabulário de erros e notas): https://learn.microsoft.com/azure/ai-services/speech-service/how-to-pronunciation-assessment
- Microsoft Reading Coach / Reading Progress: https://learn.microsoft.com/training/educator-center/product-guides/reading-progress [a verificar]
- Speechace API: https://docs.speechace.com [a verificar]
- Web Speech API (`SpeechSynthesisUtterance.onboundary`): https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/boundary_event
- MediaRecorder API: https://developer.mozilla.org/docs/Web/API/MediaRecorder
- Permissions Policy (`microphone`): https://developer.mozilla.org/docs/Web/HTTP/Headers/Permissions-Policy/microphone
