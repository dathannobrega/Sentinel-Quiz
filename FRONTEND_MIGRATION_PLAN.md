# Frontend Migration Plan

## Estrategia

- Nao substituir `frontend/` de uma vez.
- Manter o legado funcional enquanto o novo frontend nasce em `web/`.
- Migrar a jornada em fatias verticais, com rollback simples: basta voltar a servir `frontend/`.

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

## Riscos e rollback

- Risco: dualidade entre `frontend/` e `web/`.
  - Mitigacao: migracao por entrada de jornada e reuse de `localStorage`/backend.
- Risco: divergencia visual durante a transicao.
  - Mitigacao: tokens e linguagem visual herdados do CSS atual.
- Risco: contract drift com backend.
  - Mitigacao: `apiClient` tipado sobre endpoints reais e sem alterar a API existente.

## Definicao de pronto por fase

- Uma fase so e considerada pronta quando:
  - o fluxo principal roda no novo frontend
  - loading/empty/error/success estao cobertos
  - keyboard/focus basicos estao corretos
  - existe caminho de rollback simples

## Onde estamos agora

- Ja migrado:
  - dashboard
  - login/cadastro/logout
  - criacao de sessao
  - runner `exam`
  - runner `study`
  - resultado e revisao basica de ambos
- Principal backlog da trilha:
  - bookmarks/notas inline no runner de study
  - historico/analytics dedicados no app novo
  - migracao do admin
