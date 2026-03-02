# Frontend Design System (MVP)

## Onde esta

- Tokens: `web/styles/tokens.css`
- Tema/base: `web/styles/legacy-theme.css`
- Componentes base:
  - `web/components/ui/button.tsx`
  - `web/components/ui/card.tsx`
  - `web/components/ui/field.tsx`
  - `web/components/ui/status-banner.tsx`
  - `web/components/ui/skeleton.tsx`

## Tokens

### Cores

- `--sq-bg`, `--sq-surface`, `--sq-surface-subtle`, `--sq-surface-elevated`
- `--sq-text`, `--sq-text-muted`
- `--sq-accent`, `--sq-accent-strong`, `--sq-accent-alt`
- `--sq-success`, `--sq-danger`, `--sq-warning`, `--sq-info`

### Espacamento

- `--sq-space-1` a `--sq-space-8`
- Regra pratica:
  - componentes pequenos: `1` a `3`
  - grupos de formulario: `4`
  - secoes/cards: `5` a `6`
  - respiro macro da pagina: `7` a `8`

### Tipografia

- Body: `--sq-font-body`
- Display/headings: `--sq-font-display`

### Shape e elevacao

- Radius: `--sq-radius-sm`, `--sq-radius-md`, `--sq-radius-lg`
- Sombra: `--sq-shadow-sm`, `--sq-shadow-md`, `--sq-shadow-lg`

## Componentes base

### Button

- Variantes:
  - `primary`: CTA principal
  - `secondary`: CTA secundaria
  - `ghost`: acao de baixo risco
  - `danger`: acao destrutiva
- Tamanhos:
  - `md`
  - `sm`
- Regras:
  - use `busy` para impedir double submit
  - use `ghost` para acao secundaria ao lado do CTA principal

### Card

- Usar para blocos de conteudo com objetivo claro.
- Cada card deve ter:
  - titulo
  - subtitulo curto (quando necessario)
  - no maximo uma area de acoes no header

### Field

- Sempre encapsular `input`, `select` e `textarea`.
- `hint` explica a decisao.
- `error` diz o que ocorreu e como corrigir.

### StatusBanner

- `neutral`: informacao contextual
- `success`: confirmacao
- `warning`: atencao ou fallback parcial
- `danger`: erro que exige acao do usuario

### Skeleton

- Usar quando a estrutura da tela ja e conhecida.
- Preferir skeleton a spinner em cards/listas, para evitar layout shift.

## Guidelines de uso

- Um bloco deve ter um CTA principal claro; o resto entra como `ghost` ou link.
- Formularios devem sempre ter:
  - label
  - hint ou erro
  - estado disabled/loading quando aplicavel
- Estados vazios devem orientar a proxima acao.
- Mensagens de erro devem ser especificas e acionaveis.
- Reaproveitar a linguagem visual do legado ate a migracao completa, sem criar temas paralelos.
