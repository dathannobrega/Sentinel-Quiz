# Frontend Audit

> Snapshot historico da base legada que motivou a migracao. Os arquivos auditados abaixo ja foram removidos do runtime principal.

## Escopo auditado

- `frontend/index.html`
- `frontend/app.js`
- `frontend/styles.css`
- `frontend/admin.html`
- `frontend/admin.js`
- `frontend/admin.css`

## P0

### Monolito de UI e fluxo acoplado

- Evidencia:
  - `frontend/app.js` concentra carregamento inicial, auth, provas, study mode, historico, modais, AI e revisao no mesmo arquivo.
  - O arquivo tambem registra dezenas de listeners no bloco final (`frontend/app.js` na regiao `2053+`).
- Impacto:
  - Qualquer mudanca pequena exige tocar em um arquivo gigante e com alto risco de regressao.
  - Nao existe separacao clara entre estado, renderizacao, side-effects e integracao com API.
- Acao:
  - Migrar por features (`auth`, `dashboard`, `exam-runner`, `results`, `analytics`, `admin`) com componentes e servicos separados.

### DOM imperativo e renderizacao baseada em `innerHTML`

- Evidencia:
  - `frontend/app.js` usa `innerHTML` em muitos pontos (`376`, `437`, `448`, `913`, `1085`, `1197`, `1426`, `1654`, `1785`).
  - `frontend/admin.js` tambem usa `innerHTML` para cards, rows e forms (`70`, `74`, `163`, `212`, `251`).
- Impacto:
  - Dificulta composicao, reuso e testes.
  - Aumenta risco de inconsistencias visuais e bugs de foco/acessibilidade.
  - Mistura markup, estado e comportamento no mesmo trecho.
- Acao:
  - Migrar telas para JSX e componentes com props tipadas.

### Contrato de API espalhado e sem normalizacao

- Evidencia:
  - `frontend/app.js` define `apiRequest`, `apiGet`, `apiPost`, `apiPut` localmente.
  - `frontend/admin.js` define outra camada de `apiGet`, `apiPost`, `apiDelete`.
- Impacto:
  - Regras de timeout, erro, auth e headers podem divergir entre telas.
  - Fica dificil padronizar 401/403, retry seguro e observabilidade.
- Acao:
  - Centralizar em `web/lib/api/client.ts`.

## P1

### Layout e estilos reutilizam classes globais, mas ainda sem design system formal

- Evidencia:
  - `frontend/styles.css` tem boa base visual (`:root`, cards, hero, inputs), mas sem tokens documentados por camada.
  - `frontend/admin.css` complementa o tema sem componentes base compartilhados.
- Impacto:
  - O visual atual e bom, mas a evolucao cresce por copia e adaptacao de classes.
  - Estados como loading, empty e error nao nascem como primitives reutilizaveis.
- Acao:
  - Formalizar tokens e componentes base no novo `web/`.

### Fluxos de tela dependem de `hidden` + mutacao de classe

- Evidencia:
  - `frontend/app.js` alterna telas com `show()` e `classList.add/remove("hidden")`.
- Impacto:
  - Navegacao nao e url-driven.
  - Resume, historico e revisao compartilham um mesmo documento com baixa previsibilidade.
- Acao:
  - Migrar para rotas do App Router e estado por pagina.

### Baixa testabilidade

- Evidencia:
  - Nao existe estrutura de testes no frontend atual.
  - O acoplamento DOM + fetch direto dificulta mocks e testes de regressao.
- Impacto:
  - Cada refactor da UX fica dependente de validacao manual.
- Acao:
  - Introduzir testes por camada na trilha Next (`componentes`, `apiClient`, fluxo e2e).

## P2

### Consistencia de microcopy e estados pode evoluir

- Evidencia:
  - A base atual ja melhorou bastante, mas ainda depende de mensagens soltas espalhadas em `frontend/app.js`.
- Impacto:
  - Ajustes de linguagem e orientacao ao usuario continuam caros.
- Acao:
  - Consolidar texto de CTA, mensagens de erro e estados vazios por feature.

### Admin e jornada do aluno ainda compartilham o mesmo padrao de legado

- Evidencia:
  - `frontend/admin.html` e `frontend/admin.js` seguem a mesma abordagem imperativa.
- Impacto:
  - O painel editorial vai precisar de uma trilha de migracao propria apos o runner do aluno.
- Acao:
  - Priorizar aluno primeiro; migrar admin em seguida com a mesma base de design system e `apiClient`.
