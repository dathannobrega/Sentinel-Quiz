# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões seguem [SemVer](https://semver.org/lang/pt-BR/).
As imagens são publicadas no GHCR com a versão (`1.0.0`, `1.0`) quando a tag `v*` é criada.

## [Unreleased]

### Adicionado
- Serviço de voz: engine de reconhecimento **opcional** Parakeet TDT 0.6B v2 via sherpa-onnx (`uv sync --extra parakeet`, `SPEECH_ASR_ENGINE=parakeet`): 5× mais rápido e com tempos de palavra mais precisos que o Whisper `small.en`, mas detecta um pouco menos pronúncias erradas; o Whisper continua o padrão. Comparativo medido em `docs/reading/BAKEOFF-ASR.md` e ferramenta `speech/scripts/asr_bakeoff.py`.

## [1.1.1] - 2026-10-13

### Alterado
- **Praticar frases** (antes "Ouvir e repetir"): o resultado fica na tela até você escolher **Repetir esta frase** ou **Próxima frase** (Enter); "avançar sozinho" virou opção desligada por padrão. Novo **Ouvir a minha gravação** da frase e, em cada palavra, "ouvir o modelo" × "ouvir a minha gravação". A gravação fica só na memória do navegador.
- Modos renomeados para deixar claro qual pausa a cada frase: **Praticar frases** (recomendado, primeiro da lista), **Ler por frase** e **Ler o parágrafo**.
- A mensagem "análise por fonema desligada" agora diz o motivo: carregando no servidor, falhou ao carregar ou desligada na configuração (`capabilities.phonemes.reason`).
- Plano da Fase 2 em `docs/reading/PLANO-FASE-2.md`: prática que ensina, configuração pela interface, ebooks dos alunos, progresso e qualidade da avaliação.

### Corrigido
- **A análise por fonema nunca carregava no Docker** (1.1.0): o compose enviava `SPEECH_PHONEME_MODEL` vazio e o serviço tentava carregar um modelo chamado `""`. Valores vazios de `SPEECH_*` agora significam "padrão", e o compose passa o nome do modelo.

## [1.1.0] - 2026-10-12

### Adicionado
- **Sentinel Reader:** áudio **frase a frase** (a primeira frase toca em 1 a 1,5 s no M1 Pro, antes 6 s para o parágrafo inteiro), antecipação do próximo parágrafo e da próxima seção, aquecimento dos parágrafos seguintes em segundo plano com prioridade baixa, modo **"ouvir e repetir"** mãos livres com parada por silêncio, velocidades 0,5× e 0,6×, detecção do idioma do livro (voz neural e avaliação só para inglês; voz do navegador no idioma certo). Veja `docs/reading/INCREMENTO-3.md`.
- Serviço de voz: `POST /v1/tts/stream` (NDJSON), fila com prioridade (`X-Speech-Priority`), threads e concorrência automáticas pelos CPUs do container, fonemas em paralelo com o Whisper quando há 6 ou mais CPUs, métricas por prioridade e de espera na fila.

### Alterado
- Compose: `APP_SPEECH_CPUS` padrão 2.0 (cabe em qualquer máquina; ver a tabela de dimensionamento no README), threads/concorrência `0` = automático, cache de áudio de 8 GB.

## [1.0.0] - 2026-10-12

Primeira versão marcada. Reúne tudo o que já estava em produção pela `main` e o Sentinel Reader.

### Adicionado
- **Sentinel Reader (Leitura)** ([#34](https://github.com/dathannobrega/Sentinel-Quiz/pull/34)): estudo dos livros por voz.
  - Ouvir e ler junto com destaque palavra a palavra (Kokoro-82M) e fallback para a voz do navegador.
  - Shadowing e treino frase a frase com nota por palavra (faster-whisper) e por fonema (wav2vec2), com prosódia.
  - Baralho de palavras com revisão espaçada, glossário com tradução pt-BR e perguntas de compreensão (Gemini).
  - Capítulos offline no app instalado, controles na tela bloqueada, timer de sono, exportar/apagar dados.
  - Novo serviço `speech` (CPU, sem nuvem) e imagem `ghcr.io/<repo>-speech`. Docs em `docs/reading/`.
- **Sentinel Arena** (quizzes ao vivo, incrementos 1 a 7): criação com IA, telão com QR/PIN, convidados, até 2.000 por sala com sala de espera, desafios self-paced, moderação e relatórios.
- Simulados, modo estudo, revisão espaçada, PBQs, tutor de IA, admin e app instalável (PWA).

### Alterado
- Dependências: fastapi 0.143.0, sqlalchemy 2.1.4, pydantic 2.14.0, python-dotenv 1.2.4, next 16.3.8, eslint-config-next 16.3.8, @tanstack/react-query 5.104.1, vitest 5.0.3 e motion 14.

### Corrigido
- Imagem `speech` não sobe mais presa em "aquecendo" em Linux (modelo do spaCy embutido).
- CI: teste do desafio da Arena instável, checagem do `requirements.lock` que quebrava a cada versão nova de dependência indireta, e auditoria de acessibilidade da landing no primeiro acesso.
