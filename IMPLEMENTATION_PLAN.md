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

### Gaps que ainda permanecem

- Multitenancy real e ACL por tenant ainda não existem.
- A trilha de auditoria está melhor (logs estruturados + editoriais), mas ainda pode evoluir para auditoria operacional persistente de segurança.
- O admin web ainda precisa expor visualmente toda a nova qualidade editorial (hoje o backend já retorna os campos e o frontend novo preserva esses metadados sem perdê-los no save).

## 3. Plano por item

## 3.1 Banco de questões bem estruturado

### Objetivo

Transformar o banco de questões em um domínio editorial consistente, versionado, auditável e pronto para alimentar estudo, simulação e analytics.

### Mudanças de modelo de dados

- Criar tabelas:
  - `question_bank`
  - `question_version`
  - `question_option`
  - `domain_catalog`
  - `domain_blueprint`
  - `question_reference`
  - `question_stats_snapshot`
- Separar:
  - identidade estável da questão
  - versão publicada
  - rascunho em revisão
- Adicionar campos:
  - `subject`
  - `subtopic`
  - `keywords`
  - `trap_patterns`
  - `question_format`
  - `avg_time_seconds`
  - `global_accuracy_percent`
  - `review_status`
  - `blueprint_code`

### Regras de conteúdo

- Explicação obrigatória em estrutura explícita:
  - `correct_rationale`
  - `incorrect_rationales[]`
- Taxonomia oficial por certificação:
  - `certification`
  - `domain`
  - `subdomain`
  - `objective_code`
- Normalizar tipos:
  - `single_choice`
  - `multiple_response`
  - `best_answer`
  - `matching`
  - `ordering`

### Backend

- Criar serviço de validação semântica de questão.
- Criar pipeline de importação versionada:
  - parse
  - validate
  - normalize
  - deduplicate
  - store draft
  - publish
- Expor APIs paginadas de catálogo, nunca “retornar tudo”.

### Frontend/Admin

- Editor com validação por campo.
- Preview da questão no modo aluno.
- Indicadores de completude editorial.

### Critério de pronto

- 100% das questões publicadas com blueprint oficial, racional completo e tipo consistente.
- Nenhuma questão publicada sem opção correta, sem rationale ou sem domínio.

### Prioridade

- Alta. Este item é fundacional.

## 3.4 Métricas que realmente ajudam

### Objetivo

Trocar insights pontuais por analytics persistidos e comparáveis no tempo.

### Mudanças de modelo

- Criar:
  - `user_domain_metrics_daily`
  - `user_exam_metrics_snapshot`
  - `weekly_progress_snapshot`

### Métricas mínimas

- Por domínio:
  - volume realizado
  - acurácia
  - tempo médio
  - tendência 7d / 30d
  - confiança média
- Por prova:
  - score
  - tempo total
  - weak areas
- Por semana:
  - evolução
  - constância
  - backlog de revisão

### Implementação

- Atualização incremental no write-path para métricas leves.
- Recalcular agregados pesados em background.
- Frontend com dashboards:
  - domínio fraco
  - evolução semanal
  - tempo por questão
  - fila de revisão pendente

### Critério de pronto

- Analytics ficam disponíveis em tempo quase real e não dependem de varrer todas as sessões a cada request.

### Prioridade

- Alta. Essencial para escalar sem degradar performance.

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

## 3.6 Qualidade pedagógica

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

### Prioridade

- Média-alta. Muito valioso, mas depende do modelo de tentativas amadurecido.

## 3.7 Gestão de conteúdo (lado admin)

### Objetivo

Substituir o editor simples atual por um CMS editorial com workflow real.

### Mudanças de modelo

- Criar:
  - `editor_user`
  - `question_draft`
  - `question_revision`
  - `question_approval`
  - `audit_log`
- Estados:
  - `draft`
  - `in_review`
  - `approved`
  - `published`
  - `archived`

### Workflow

- Editor cria ou altera draft.
- Revisor técnico valida.
- Publicação gera nova versão.
- Rollback publica versão anterior.

### QA pipeline

- Duplicidade semântica.
- Opções inconsistentes.
- Tags fora do blueprint.
- Explicação incompleta.
- Referência ausente.

### Critério de pronto

- Nenhuma alteração de questão vai direto para produção sem trilha de aprovação.

### Prioridade

- Alta se houver mais de um editor. Média se o time ainda for muito pequeno.

## 3.8 Anti-frustração e retenção

### Objetivo

Manter ritmo e adesão sem virar gamificação vazia.

### Funcionalidades

- `daily_goal`
- streak leve
- meta semanal
- simulados adaptativos
- plano pós-prova orientado a ação

### Implementação

- Criar:
  - `user_goal`
  - `user_streak`
  - `adaptive_profile`
- Regra adaptativa:
  - priorizar domínio fraco
  - penalizar baixa confiança
  - respeitar variedade mínima para não viciar o treino

### Cuidado de produto

- Não usar mecânicas intrusivas.
- Não punir ausência com UX agressiva.

### Critério de pronto

- O produto aumenta recorrência sem reduzir qualidade pedagógica.

### Prioridade

- Média. Vem depois da base de aprendizado e analytics.

## 3.9 Segurança e confiabilidade

### Objetivo

Proteger conteúdo, dados do usuário e operação.

### Segurança de aplicação

- Autenticação:
  - JWT com refresh token
  - sessão revogável
- ACL por papel:
  - aluno
  - editor
  - reviewer
  - admin
- Rate limiting:
  - por IP
  - por usuário
  - por endpoint sensível
- Anti-scraping:
  - paginação forçada
  - limites de exportação
  - anomalia por volume

### Segurança de dados

- PostgreSQL com backups automáticos.
- Criptografia em trânsito.
- Segredos fora do código.
- Logs estruturados sem vazar conteúdo sensível.

### Confiabilidade

- Health checks reais:
  - DB
  - worker
  - queue
- Observabilidade:
  - logs estruturados
  - métricas
  - tracing
- Alertas:
  - erro 5xx
  - fila travada
  - falha de backup

### Critério de pronto

- Endpoints críticos protegidos, catálogos paginados e trilha operacional monitorada.

### Prioridade

- Crítica. Deve entrar desde a Fase 1, não no fim.

## 4. Ordem de implementação recomendada

## Fase 0: Fundação técnica

- Migrar para PostgreSQL.
- Introduzir Alembic.
- Estruturar settings por ambiente.
- Adicionar autenticação básica e papéis.
- Adicionar rate limiting, paginação e logging estruturado.

## Fase 1: Modelo de dados de produção

- Refatorar domínio de questões para versionamento e blueprint oficial.
- Separar `study_session`, `exam_session` e `question_attempt`.
- Criar bookmarks e notas.

## Fase 2: Modos de estudo e revisão

- Study mode completo.
- Exam mode timed robusto.
- Custom quiz multi-filtro.
- Fila de revisão + repetição espaçada.

## Fase 3: Analytics escaláveis

- Agregados persistidos.
- Dashboard por domínio.
- Histórico semanal.
- Adaptativo inicial.

## Fase 4: CMS editorial

- Draft/review/publish.
- Auditoria.
- Rollback.
- Pipeline de QA de conteúdo.

## Fase 5: Retenção e refinamento pedagógico

- Confiança.
- Hints graduais.
- Daily goals.
- Simulado adaptativo refinado.

## 5. Entregáveis técnicos por fase

### Em cada fase, entregar:

- schema migrations
- testes unitários
- testes de integração
- contrato de API versionado
- documentação operacional
- métricas de observabilidade
- checklist de rollback

## 6. Riscos de execução

### Riscos principais

- Crescer em cima do modelo atual sem separar domínio editorial e de aprendizagem.
- Persistir em SQLite por tempo demais.
- Misturar regra pedagógica com lógica de UI.
- Recalcular analytics em tempo real consultando sessões inteiras.
- Manter admin “write directly to production” sem aprovação.

### Mitigações

- Refatorar schema antes de adicionar mais features de UX.
- Introduzir serviços de domínio e jobs assíncronos.
- Centralizar regras de revisão e adaptatividade no backend.
- Versionar conteúdo e publicar por workflow.

## 7. Melhor prática de implementação

### Padrões recomendados

- Domain-driven modularization simples.
- Service layer explícita.
- DTOs separados de ORM.
- Regras de negócio cobertas por testes.
- APIs paginadas, com filtros explícitos e limites.
- Writes idempotentes quando possível.
- Soft delete onde houver trilha editorial.
- Audit trail imutável.

### O que evitar

- Lógica crítica no frontend.
- endpoints administrativos sem granularidade.
- retorno massivo de banco de questões completo.
- migrations implícitas no startup.
- acoplamento de conteúdo publicado e rascunho na mesma entidade.

## 8. Recomendação prática para este projeto

### Próxima implementação que mais gera valor com menor risco

1. Migrar de SQLite para PostgreSQL + Alembic.
2. Introduzir usuários, autenticação e tabelas de progresso.
3. Separar `study_mode` de `exam_mode`.
4. Adicionar bookmarks, notas e confiança por tentativa.
5. Persistir fila de revisão com agendamento simples.
6. Trocar analytics on-demand por snapshots agregados.
7. Refatorar o admin para draft/review/publish com auditoria.

### O que não recomendo fazer agora

- Implementar tudo de uma vez no modelo atual.
- Adicionar gamificação avançada antes da camada de revisão e identidade.
- Expandir tipos complexos de questão antes de consolidar o fluxo editorial/versionado.

## 9. Definição de “pronto para produção”

O sistema só deve ser considerado realmente pronto para produção quando atender, no mínimo:

- PostgreSQL em vez de SQLite.
- Autenticação + papéis.
- Rate limiting e paginação.
- Migrations versionadas.
- Logs estruturados + backups.
- Progresso por usuário persistido.
- Review queue persistida.
- CMS com auditoria e rollback.
- Testes automáticos cobrindo regras de negócio críticas.

Sem isso, novas funcionalidades aumentam valor de UX, mas não tornam a plataforma “pronta para produção escalável”.
