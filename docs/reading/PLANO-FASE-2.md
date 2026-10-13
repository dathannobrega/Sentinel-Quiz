# Sentinel Reader, Fase 2: aprender inglês lendo, de ponta a ponta

> **Status:** proposta para decisão, **revisão 1**. **Data de referência:** 13/10/2026. **Idioma:** pt-BR.
> **Base:** os três incrementos entregues (v1.0.0 e v1.1.0), o uso real numa VM de 4 vCPUs e os pedidos de 13/10: tempo para revisar o erro antes de repetir, análise por fonema desligada sem explicação, pausa a cada frase, **configuração pela interface** e **importação de ebooks pelos alunos**.
> **Convenções:** **[a verificar]** fato de mercado ou técnico não confirmado em fonte primária; **[estimativa]** número a medir; **[decisão]** escolha deste plano; **[hipótese]** afirmação de produto sem medição.

---

## Índice

- [0. Sumário executivo](#0-sumário-executivo)
- [1. O que o uso real mostrou](#1-o-que-o-uso-real-mostrou)
- [2. Pedagogia: como se aprende a falar lendo](#2-pedagogia-como-se-aprende-a-falar-lendo)
- [3. Modelos: revisão de outubro de 2026](#3-modelos-revisão-de-outubro-de-2026)
- [4. Épico A: prática que ensina](#4-épico-a-prática-que-ensina)
- [5. Épico B: configuração pela interface](#5-épico-b-configuração-pela-interface)
- [6. Épico C: ebooks dos alunos](#6-épico-c-ebooks-dos-alunos)
- [7. Épico D: progresso e motivação](#7-épico-d-progresso-e-motivação)
- [8. Épico E: qualidade da avaliação](#8-épico-e-qualidade-da-avaliação)
- [9. Arquitetura e dados](#9-arquitetura-e-dados)
- [10. Segurança, privacidade e licenças](#10-segurança-privacidade-e-licenças)
- [11. Requisitos não funcionais](#11-requisitos-não-funcionais)
- [12. Roadmap](#12-roadmap)
- [13. Riscos](#13-riscos)
- [14. Métricas](#14-métricas)
- [15. Questões em aberto](#15-questões-em-aberto)

---

## 0. Sumário executivo

A Fase 1 provou a mecânica: ouvir lendo junto, repetir frases com nota por palavra e por fonema, tudo local. A Fase 2 transforma a mecânica num **método**:

1. **Prática que ensina** (Épico A): cada erro vira um ciclo curto de "ouvir o modelo, ouvir a mim, repetir só isso", com tempo para ler o resultado; pares mínimos e sons difíceis para brasileiros; shadowing simultâneo de verdade; leitura em voz alta com meta de ritmo.
2. **Configuração pela interface** (Épico B): tudo o que hoje é variável de ambiente e pode mudar sem reiniciar vira tela: para o aluno (voz, velocidade, limiares, pausas) e para o administrador (engines, modelos, threads, cache, quotas, aquecimento), com estado do serviço de voz visível.
3. **Ebooks dos alunos** (Épico C): o aluno envia EPUB, PDF ou texto; o servidor converte para o mesmo JSON do corpus, detecta idioma, guarda **só para aquele aluno**, com quota e exclusão. Os conversores que hoje rodam à mão viram uma biblioteca com fila de jobs.
4. **Progresso e motivação** (Épico D): nível estimado, sons dominados e pendentes, metas semanais, histórico por livro.
5. **Qualidade da avaliação** (Épico E): gravações reais com consentimento para calibrar, revisão dos limiares, modelos mais fortes quando a máquina permite.

**Decisões principais**

| # | Decisão | Por quê |
|---|---|---|
| D1 | A unidade de aprendizagem é a **frase**; o parágrafo é modo avançado **[decisão]** | Foi o que o uso real pediu: pausa para falar, tempo para revisar. Reading Coach, ELSA e Speechify trabalham por frase. |
| D2 | Configuração em **duas camadas**: preferências do aluno (no banco, por usuário) e configuração da instância (no banco, pelo admin, com "aplicar" e "pendente de reinício" quando o item exige) **[decisão]** | Variáveis de ambiente continuam como padrão e teto; a interface só muda o que é seguro. |
| D3 | Livros dos alunos ficam **privados por usuário**, em pasta própria, fora da imagem e fora do corpus compartilhado **[decisão]** | Licença: o aluno afirma ter o direito de uso pessoal; nada é redistribuído. |
| D4 | Conversão em **job assíncrono** com limites (tamanho, páginas, tempo) e sem DRM **[decisão]** | PDF/EPUB grandes levam minutos; EPUB com DRM não é legível e não deve ser tentado. |
| D5 | Modelos continuam **locais e abertos**; upgrade de ASR só por tabela de medição na própria máquina **[decisão]** | §3: o melhor modelo para a VM de 4 vCPUs não é o melhor do ranking. |

## 1. O que o uso real mostrou

| Observação (13/10) | Causa | Resposta |
|---|---|---|
| "Não dá tempo de ver o que errei antes de repetir" | O resultado ficava 3 s e o ciclo seguia sozinho | **Corrigido na v1.1.1:** o resultado espera o aluno; botões "Repetir esta frase", "Próxima frase", "Ouvir a minha gravação" e, por palavra, "ouvir o modelo" × "ouvir a minha gravação"; avanço automático vira opção |
| "A análise por fonema está desligada" sem explicar | O modelo wav2vec2 ainda carregando, com erro de memória, ou `SPEECH_PHONEME_ENGINE=none` | **Corrigido na v1.1.1:** a mensagem diz o motivo (carregando, falhou, desligado) a partir de `/healthz`; Épico B mostra o estado dos engines na interface |
| "O shadowing devia parar a cada frase" | O modo "Shadowing" avaliava o parágrafo inteiro; o modo por frase existia com outro nome | **Corrigido na v1.1.1:** modos renomeados ("Praticar frases" é o primeiro e recomendado; "Ler por frase"; "Ler o parágrafo") com dica no parágrafo; Épico A completa |
| Primeiro parágrafo lento na VM | Síntese do parágrafo inteiro, threads acima dos núcleos | Resolvido na v1.1.0 (frase a frase, threads automáticas) |

## 2. Pedagogia: como se aprende a falar lendo

Princípios usados pelos produtos de referência (Microsoft Reading Coach, ELSA, Speechify, Google Read Along, LingQ) e pela literatura de ensino de pronúncia **[a verificar nas fontes citadas no Apêndice do PLANO.md]**:

1. **Input antes de output:** ouvir o modelo da frase antes de falar (já temos).
2. **Feedback imediato, específico e acionável:** não "errou", mas "o /θ/ de *threat* saiu como /t/: ouça o modelo, ouça o seu, repita só a palavra". Falta hoje o **ciclo por palavra** e o **ouvir a mim** (entregues na v1.1.1) e a **prática do som isolado** (Épico A).
3. **Repetição espaçada do que foi difícil:** o baralho de palavras existe; falta um baralho de **sons** (pares mínimos) e a entrada automática por fonema.
4. **Ritmo e entonação, não só sons:** shadowing simultâneo (falar junto com o modelo) treina ritmo; leitura em voz alta com meta de palavras por minuto treina fluência. Hoje a prosódia é só medida.
5. **Zona de conforto crescente:** começar por frases curtas e velocidade 0,75×, subir conforme a nota; nunca punir: o aluno escolhe repetir ou seguir.
6. **Compreensão junto com pronúncia:** glossário e perguntas por seção existem; falta ligar a leitura ao estudo (ler a seção por trás de uma questão errada).
7. **Erros típicos de falantes de português:** /θ ð/ → /t d f v/, /ɪ/ × /iː/ (*ship/sheep*), /æ/ × /ɛ/ (*bad/bed*), /h/ mudo ou /ɹ/ como /h/, vogal de apoio em final de palavra (*bigi*), /s/ inicial com /i/ (*istudy*). O modelo de fonemas já separa a maioria; falta **nomear** o erro em português e dar o exercício certo.

## 3. Modelos: revisão de outubro de 2026

Critérios: licença permissiva, CPU, qualidade, timestamps por palavra (TTS) ou por palavra com confiança (ASR), peso. Tudo o que está marcado **[a verificar]** precisa de leitura do model card e de medição na nossa máquina antes de entrar.

### 3.1 TTS

| Modelo | Situação | Veredito |
|---|---|---|
| **Kokoro-82M** (em uso) | Apache 2.0, CPU, timestamps por token, qualidade alta para leitura didática | **Mantém.** Falta explorar: vozes `p*` para pt-BR (Épico C, livros em português) e mistura de vozes para variar o modelo. |
| Chatterbox Turbo / Chatterbox Multilingual | MIT, mais expressivo, GPU/MPS; versão multilíngue cobre pt-BR **[a verificar]** | Modo "narração expressiva" só onde houver GPU. Fica como engine opcional (Épico B permite escolher). |
| Supertonic 3 | ONNX, CPU rápido, OpenRAIL-M | Depende de parecer jurídico sobre o OpenRAIL-M. Reavaliar. |
| Pocket TTS, Piper | Leves | Reserva para máquinas muito fracas; sem timestamps. |

### 3.2 ASR para avaliação de leitura

| Modelo | Situação | Veredito |
|---|---|---|
| **faster-whisper `small.en`** (em uso) | MIT, int8 CPU, palavras com confiança; aceita pronúncia ruim como certa (compensado pelo wav2vec2) | **Mantém como padrão em máquinas de 4 vCPUs.** |
| faster-whisper `large-v3-turbo` / `distil-large-v3` | Melhor WER; 2 a 4× mais pesado **[estimativa]** | Opção no Épico B para máquinas de 8+ núcleos; medir latência na tabela de dimensionamento. |
| **NVIDIA Parakeet TDT 0.6B v2** via sherpa-onnx (int8, CPU) | CC-BY-4.0; WER muito baixo em inglês e timestamps por palavra; CPU viável com sherpa-onnx **[a verificar]** | **Candidato principal a substituir o Whisper** na avaliação: menos "autocorreção" por não ter decodificador autoregressivo forte **[hipótese]**. Entra num **bake-off** (Épico E) com a ferramenta de calibração. |
| whisper.cpp / CoreML | MIT | Útil só no Mac nativo; não entra no container. |

### 3.3 Fonemas e prosódia

| Modelo | Situação | Veredito |
|---|---|---|
| **wav2vec2-lv-60-espeak-cv-ft** (em uso) | Apache 2.0, 1,2 GB, CPU | **Mantém.** Problema real é operacional (carga de 1,3 GB de RAM, download no primeiro start): Épico B mostra o estado e permite desligar/ligar pela interface. |
| wav2vec2-xlsr-53-espeak-cv-ft | Apache 2.0, multilíngue | Alternativa para livros em pt-BR (Épico C). |
| Modelos de GOP dedicados (ex.: *speechocean762*-based) | Variados **[a verificar]** | Avaliar no bake-off; a maioria é pesquisa, sem pacote estável. |
| Prosódia (F0 por autocorrelação, em uso) | suficiente para monotonia e pausas | Acento de palavra e entonação de pergunta via comparação de contorno com o modelo (Épico A). |

### 3.4 Texto (IA)

| Uso | Hoje | Plano |
|---|---|---|
| Glossário, compreensão | Gemini 2.5 Flash via API, com cache e quota | Mantém; Épico B permite escolher modelo e limitar custo pela interface; Épico A usa a mesma IA para **explicar o erro de pronúncia em português** (a partir do par de fonemas, com cache por par). |

## 4. Épico A: prática que ensina

| Item | O que é | Critério de pronto |
|---|---|---|
| A1 **Revisão no ritmo do aluno** (v1.1.1) | Resultado espera; "Repetir", "Próxima", "Ouvir a minha gravação"; por palavra: modelo × minha gravação; avanço automático opcional | feito |
| A2 **Ciclo por palavra** | Numa palavra marcada: ouvir o modelo (lento e normal), ouvir a mim, gravar **só a palavra**, nota por fonema da palavra; até 3 vezes; entra no baralho se continuar ruim | palavra isolada avaliada com `sentence_index`-like `word_index`; tempo de ciclo < 4 s na VM **[estimativa]** |
| A3 **Sons difíceis para brasileiros** | Catálogo de 12 contrastes (θ/t, ð/d, ɪ/iː, æ/ɛ, v/w, h, ɹ, final -ed, -s, vogal de apoio…) com explicação em português, exemplos do próprio livro e pares mínimos; entrada automática pelos `tips` | cada `tip` liga para o seu contraste; exercício de par mínimo com 10 pares por som |
| A4 **Shadowing simultâneo** | Modo em que o modelo toca a frase em volume reduzido enquanto o aluno fala junto; a nota considera ritmo (alinhamento temporal com o modelo) mais do que fonemas | correlação de tempos por palavra ≥ 0,8 conta como "no ritmo" **[estimativa]** |
| A5 **Leitura em voz alta com meta** | "Ler o parágrafo" ganha meta de palavras por minuto por nível e gráfico de evolução; sem modelo antes (leitura fria) | WPM e precisão por tentativa no histórico |
| A6 **Dificuldade progressiva** | Frases ordenadas por tamanho/dificuldade na primeira passada; velocidade do modelo sugerida pelo histórico (0,75× até a nota subir) | velocidade sugerida visível e editável |
| A7 **Ler a seção por trás do erro** | No feedback de uma questão errada, "Praticar esta seção em voz alta" abre o leitor no modo frases | link existe e abre no modo certo |
| A8 **Explicação do erro em português (IA)** | Para cada par de fonemas, texto curto gerado uma vez e cacheado (como articular, exemplo, erro típico) | 100 % dos pares do catálogo com texto revisado |

## 5. Épico B: configuração pela interface

### 5.1 Preferências do aluno (`/read/settings` e no player)
Voz, velocidade, avanço automático, segundos de resultado, limiar de aprovação (85 % padrão), tentativas por frase, sensibilidade do silêncio, "toque para traduzir", idioma da interface do leitor, metas (minutos/dia). Guardadas no banco (`reading_preference`, por usuário), com `localStorage` só como cache.

### 5.2 Configuração da instância (`/admin/reading`)
| Grupo | Itens | Aplicação |
|---|---|---|
| Serviço de voz: estado | engines (TTS, ASR, fonemas) com `ready`/`warming`/`failed` e erro, runtime (CPUs, threads, concorrência, paralelo), cache (tamanho, hits), fila (espera por prioridade), versão | leitura de `/healthz` e `/metrics` pelo backend; auto-refresh 10 s |
| Serviço de voz: ajustes a quente | vozes oferecidas, voz padrão, velocidades, limiar `weak`, limiar de fonema, pesos das notas, formato do áudio, tamanho do cache, tempo de espera de prioridade baixa | `PUT /v1/config` no `speech` (novo), persistido em `reading_setting` no banco e reenviado no start |
| Serviço de voz: reinício necessário | engine e modelo (TTS, ASR, fonemas), threads, concorrência, paralelo | salvos como "pendente"; o admin reinicia o container; o `speech` lê `SPEECH_CONFIG_URL` (o backend) no boot, com as variáveis de ambiente como teto |
| Leitura | quotas diárias, aquecimento (ligado, blocos à frente), capítulos offline, idiomas permitidos, IA (modelo, quota) | `reading_setting`; lidos pela API em cada pedido com cache de 30 s |
| Livros | corpus compartilhado (lista, idioma detectado, reconverter), livros dos alunos (uso de disco, quotas) | Épico C |

Auditoria: toda mudança registra quem, quando, de/para (`editorial_audit_log` já existe; usar o mesmo padrão).

## 6. Épico C: ebooks dos alunos

| Item | O que é |
|---|---|
| C1 **Envio** | `/read/my-books`: upload de EPUB, PDF, TXT ou MD (até `READING_UPLOAD_MAX_MB`, 50), com aceite explícito ("tenho o direito de usar este arquivo para estudo pessoal"); fila por usuário (`READING_IMPORT_QUOTA_BOOKS`, 10 livros; `READING_IMPORT_QUOTA_MB`, 500) |
| C2 **Conversão** | `scripts/convert_*_to_json.py` viram `backend/app/services/book_import/` (biblioteca testável: EPUB via `zipfile` + HTML; PDF via `pdftotext` no container, com `pdfplumber` como alternativa **[a verificar]**; TXT/MD por títulos); job em background (mesmo executor do aquecimento ou `ai-worker`), com progresso, limite de tempo (10 min) e de páginas (2.000); EPUB com DRM (`encryption.xml`) recusado com mensagem clara |
| C3 **Corpus por usuário** | Saída em `MATERIAL_DIR/users/<user_id>/<slug>/` (mesmo formato do corpus); `material_corpus` ganha `get_user_corpus(user_id)`; ids `u:<user_id>:<slug>:<cap>:<ancora>`; todas as rotas do Reader aceitam livros do usuário só para o dono; detecção de idioma na importação |
| C4 **Gestão** | Lista com estado (convertendo, pronto, falhou), idioma, tamanho, progresso de leitura; excluir (apaga JSON, cache de áudio do usuário via prefixo e progresso); reconverter |
| C5 **Operação** | Volume `material_users` no compose; limpeza de livros de contas excluídas (cascata + job); limites de disco e aviso no admin |
| C6 **Qualidade da conversão** | Relatório por livro (capítulos, seções, palavras, avisos) e visualização antes de confirmar; PDFs com duas colunas ou escaneados (sem texto) são recusados com explicação |

## 7. Épico D: progresso e motivação

Nível estimado por faixa (A2/B1/B2 **[hipótese]**: combinação de WPM, precisão e vocabulário lido), sons dominados × pendentes (do catálogo A3), metas semanais com lembrete opcional, histórico por livro e por seção, exportação já existente ampliada. Painel do aluno em `/read/progress` e cartão no dashboard.

## 8. Épico E: qualidade da avaliação

| Item | O que é |
|---|---|
| E1 **Doação de gravações (opt-in)** | Na primeira gravação, oferta clara: "guardar minhas gravações para melhorar a avaliação"; desligada por padrão; gravações ficam no volume, ligadas ao usuário, apagáveis em "Seus dados"; exportáveis pelo admin em lote anonimizado para `calibrate.py --dataset` |
| E2 **Rotulagem** | Tela simples para rotular palavras (ok/erro) em gravações doadas; precisão/recall por status por versão de modelo |
| E3 **Bake-off de ASR** | Parakeet (sherpa-onnx) × Whisper small/turbo na mesma máquina e no mesmo dataset; decisão por tabela (latência, revocação de erro, falsos "ok") |
| E4 **Limiares por aluno** | Limiar de `weak` e de fonema ajustáveis pelo nível (mais leniente no início) |

## 9. Arquitetura e dados

- **Backend:** `reading_preference` (user, json, updated_at), `reading_setting` (key, json, updated_by, updated_at, restart_required), `user_book` (id, user, slug, title, source_type, status, language, bytes, pages, warnings_json, created_at), `user_book_job` (progress, log, started/finished), `reading_recording` (opt-in; id, user, attempt_id, path, bytes, created_at). Migrações `0028`–`0030`.
- **Speech:** `GET/PUT /v1/config` (itens a quente), `SPEECH_CONFIG_URL` opcional no boot, `/healthz` já expõe estado; `POST /v1/assess` ganha `word_index` (A2) e `mode=shadow_sync` (A4, devolve alinhamento temporal com o modelo quando o cliente envia o `audio_id` do modelo).
- **Web:** `/read/settings`, `/read/my-books`, `/read/progress`, `/admin/reading`; componentes de ciclo por palavra, pares mínimos e shadowing simultâneo.

## 10. Segurança, privacidade e licenças

- Livros dos alunos: aceite registrado (texto, versão, data); nunca compartilhados; nunca na imagem; excluídos com a conta; sem download do arquivo original (só o JSON derivado serve ao leitor).
- Uploads: tipo por conteúdo (magic bytes), tamanho, descompactação limitada (zip bomb), conversão em processo separado com timeout e sem rede.
- Gravações doadas: opt-in explícito, finalidade declarada, exclusão a qualquer momento, acesso só por admin, exportação anonimizada.
- Configuração pela interface: só `admin`; itens perigosos (threads, concorrência) com limites pelo runtime detectado; auditoria.

## 11. Requisitos não funcionais

| Item | Alvo |
|---|---|
| Ciclo por palavra (A2) numa VM de 4 vCPUs | < 4 s do fim da gravação ao resultado **[estimativa]** |
| Conversão de EPUB de 500 páginas | < 60 s; PDF de 500 páginas < 3 min **[estimativa]** |
| Mudança de configuração a quente | aplicada em < 5 s, sem derrubar pedidos em andamento |
| Disco por aluno | quota padrão 500 MB (JSON + cache de áudio do usuário) |

## 12. Roadmap

| Inc. | Conteúdo | Critério de pronto |
|---|---|---|
| **v1.1.1 (feito)** | A1, motivo da análise por fonema, modos renomeados | — |
| **4** | Épico B (preferências do aluno; admin com estado e ajustes a quente) + A3 (catálogo de sons) + A8 | admin vê os engines e ajusta limiares sem reiniciar; aluno guarda preferências na conta |
| **5** | Épico C (importação de ebooks) | aluno envia um EPUB e pratica nele em até 2 min; exclusão apaga tudo |
| **6** | A2, A4, A5, A6, A7 | ciclo por palavra e shadowing simultâneo medidos na VM |
| **7** | Épico E (gravações opt-in, rotulagem, bake-off de ASR) + Épico D | tabela de bake-off com decisão; nível e metas no painel |
| **8** | Reinício orquestrado do `speech` pelo admin, livros em pt-BR (Kokoro `p*`, xlsr fonético), narração expressiva opcional | — |

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Conversão de PDF de baixa qualidade frustra o aluno | relatório prévio com avisos; recusa de escaneados; TXT/MD como alternativa |
| Configuração a quente deixa o `speech` inconsistente | só itens sem estado de modelo a quente; o resto "pendente de reinício" com diff visível |
| Catálogo de sons errado ou genérico | revisão por professor de inglês antes de publicar; textos da IA sempre cacheados e revisados |
| Doação de gravações sem confiança | opt-in, finalidade, exclusão fácil, nada por padrão |
| Parakeet não roda bem em CPU pequena | bake-off decide por máquina; Whisper continua padrão |

## 14. Métricas

Frases praticadas por sessão, taxa de "repetir" × "seguir", evolução da nota por som (catálogo), livros importados e taxa de falha de conversão, uso das telas de configuração, tempo do ciclo por palavra (p95).

## 15. Questões em aberto

| # | Questão | Dono |
|---|---|---|
| Q1 | Quota de disco por aluno e limite de livros: 500 MB / 10 é razoável? | produto |
| Q2 | Texto do aceite de direitos do ebook: revisão jurídica | jurídico |
| Q3 | Parakeet via sherpa-onnx atende ao requisito de licença (CC-BY-4.0 com atribuição na interface)? | jurídico |
| Q4 | Reinício do `speech` pela interface: via Docker socket (risco) ou só instrução ao admin? | infra |
