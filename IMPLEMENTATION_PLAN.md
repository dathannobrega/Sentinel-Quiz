## 0. Status atual

### O que já foi fechado nas últimas fatias

- Runtime principal preparado para PostgreSQL, com `docker-compose` e `Portainer` orientados a Postgres.
- Auth do frontend principal migrada para cookie HttpOnly (`AUTH_COOKIE_*`), sem persistir bearer token em `localStorage`.
- Operações editoriais agora exigem sessão autenticada com papel `admin`; não existe mais atalho por chave estática.
- Criação pública de sessão endurecida: a API pública não aceita mais `question_ids`.
- Feedback imediato de `exam/study` não devolve mais `correct_keys`; o gabarito completo fica para revisão final.
- Restrições de banco agora garantem owner escopado (`user_id` xor `client_key`) nas tabelas críticas.
- `user_question_progress` passa a consolidar progresso por questão, reduzindo o acoplamento exclusivo a “sessão”.
- O SRS agora considera também tempo de resposta além de confiança e histórico.
- Analytics editoriais agora podem gerar snapshots históricos por `question_version`, permitindo comparar dificuldade e atrito ao longo do tempo.
- Como o produto ainda não entrou em produção, a cadeia de migrations foi consolidada em um baseline único alinhado ao schema atual.
- `Exam mode` agora roda com timer real no backend, pausa controlada e auto-submit por timeout.
- `Custom quiz` já aceita filtros combináveis por domínio, dificuldade, tags, erradas, marcadas, novas, notas e baixa confiança.
- A inbox de revisão agora suporta recortes por “vence hoje”, “atrasadas”, “em risco”, bookmarks e notas.
- O domínio editorial agora persiste `domain_catalog`, `domain_blueprint` e `question_reference`, com validação semântica de questão, `quality` por campo e importação sincronizada com `question_version`.
- Métricas de aprendizado agora têm escrita incremental em `user_domain_metrics_daily`, `user_exam_metrics_snapshot` e `weekly_progress_snapshot`, reduzindo a dependência de varrer sessões a cada leitura.
- O CMS editorial agora opera com workflow explícito `draft -> in_review -> approved -> published`, auditado, e o admin web já expõe um painel visual de qualidade/completude por questão.

de evoluir para auditoria operacional persistente de segurança.

## 3. Plano por item


## 3.5 UX básica bem feita

### Objetivo

Dar consistência entre descoberta, prática, revisão e continuidade em multi-device.

### Melhorias

- Busca unificada por:
  - domínio
  - tag
  - keyword
  - texto parcial
- Filtros persistentes na UI.
- Sincronização real via backend:
  - progresso
  - bookmarks
  - notas
  - filas de revisão
- Retomar sessão em qualquer device.

### Requisitos técnicos

- Sessões associadas a usuário autenticado.
- Estratégia de conflito:
  - “last write wins” para estados simples
  - versionamento para notas

### Critério de pronto

- Usuário começa no desktop, continua no mobile e mantém contexto.

### Prioridade

- Média-alta. Depende da camada de identidade.

### Status atual

- Implementado:
  - busca unificada por domínio, tag, keyword e texto parcial, com paginação e filtros backend.
  - filtros persistentes no dashboard do frontend.
  - sincronização real por backend para progresso, bookmarks, notas e fila de revisão.
  - listagem de sessões ativas para retomar prova/estudo em qualquer device autenticado.
- Ainda evoluível:
  - elevar a busca para FTS dedicada se o volume crescer muito além do banco atual.


### Objetivo

Aumentar o valor didático sem transformar o produto em “gabarito decorado”.

### Funcionalidades

- Confiança por resposta:
  - `guess`
  - `not_sure`
  - `confident`
- Hints graduais:
  - nível 1: direciona conceito
  - nível 2: restringe domínio da resposta
  - nível 3: explica erro comum
- Referências oficiais:
  - NIST
  - ISO
  - blueprint/objective
  - material interno

### Mudanças de modelo

- `question_attempt.confidence_level`
- `question_hint`
- `reference_catalog`

### Regras

- Hint nunca revela a alternativa correta diretamente.
- Confiança pesa na revisão espaçada e no adaptativo.

### Critério de pronto

- Analytics e fila de revisão passam a considerar “acerto inseguro” como sinal pedagógico.

### Status atual

- Implementado:
  - `confidence_level` agora aceita `guess`, `not_sure` e `confident`, com normalização segura no backend.
  - `study mode` ganhou hints graduais por nível, restritos à questão ativa da sessão.
  - feedback imediato agora devolve referências oficiais/curadas e marca “acerto inseguro”.
  - sinais de confiança não alta entram no bucket pedagógico usado por métricas e adaptativo.
- Ainda evoluível:
  - calibrar hints por autor/editor manual (hoje a base é derivada dos metadados editoriais e referências).

### Prioridade

- Média-alta. Muito valioso, mas depende do modelo de tentativas amadurecido.

