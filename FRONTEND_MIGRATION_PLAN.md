# Frontend Migration Plan

## Estrategia

- A migracao incremental foi concluida no `web/`.
- O frontend legado foi removido do runtime e do repositorio.
- O foco agora e hardening: testes, validacao de build e refinamentos finais de UX.

## Etapas

### Fase 1

- Entregar `web/` com Next.js App Router + TypeScript.
- Formalizar tokens, componentes base e `apiClient`.
- Migrar a tela inicial/dashboard:
  - auth
  - overview de estudo
  - analytics de areas fracas
  - criacao de sessao
- Status: implementado nesta fatia.

### Fase 2

- Migrar o runner de prova (`exam mode` e `study mode`) para rotas dedicadas:
  - `/exam/[sessionId]`
  - `/study/[sessionId]`
- Manter autosave, revisao depois, timer e confirmacao de saida.
- Reusar os endpoints ja existentes; nao mudar contrato.
- Status: implementado nesta fatia, com navegacao sequencial suportada pela API atual.

### Fase 3

- Migrar resultado, revisao de prova e revisao de estudo:
  - `/results/[sessionId]`
  - `/study/review/[sessionId]`
- Preservar explicacoes, erros relevantes, citations e links para materiais.
- Status: implementado como rotas aninhadas:
  - `/exam/[sessionId]/result`
  - `/study/[sessionId]/result`

### Fase 4

- Migrar historico, analytics e fila de revisao.
- Adicionar filtros mais densos, busca e comparativos temporais.

### Fase 5

- Migrar o admin para um app editorial React:
  - lista de questoes
  - editor
  - QA basico
  - export/import
- Status: implementado nesta fatia para o fluxo principal editorial:
  - `/admin`
  - overview
  - busca
  - CRUD de prova/questao
  - reimportacao
  - exportacao

## Riscos e rollback

- Risco: divergencia visual apos a consolidacao.
  - Mitigacao: tokens e linguagem visual herdados do CSS atual.
- Risco: contract drift com backend.
  - Mitigacao: `apiClient` tipado sobre endpoints reais e sem alterar a API existente.

## Definicao de pronto por fase

- Uma fase so e considerada pronta quando:
  - o fluxo principal roda no novo frontend
  - loading/empty/error/success estao cobertos
  - keyboard/focus basicos estao corretos
  - existe build e deploy reproduziveis via Docker

## Onde estamos agora

- Ja migrado:
  - dashboard
  - login/cadastro/logout
  - criacao de sessao
  - runner `exam`
  - runner `study`
  - resultado e revisao basica de ambos
  - historico e analytics principais
  - admin editorial
- Principal backlog da trilha:
  - refinamentos de UX do estado de estudo inline
  - testes automatizados reais do app Next
  - observabilidade e validacao automatica de build/deploy
