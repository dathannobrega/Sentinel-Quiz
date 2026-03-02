# Frontend Route Map

## Estado atual

- O frontend legado foi removido.
- Toda a jornada de aluno e admin roda em `web/`.

## Nova estrutura em `web/`

### Implementado

- `web/app/page.tsx`
  - Feature: `dashboard`
  - Componentes:
    - `web/features/dashboard/components/dashboard-shell.tsx`
    - `web/features/dashboard/components/account-panel.tsx`
    - `web/features/dashboard/components/exam-launcher.tsx`
    - `web/features/dashboard/components/insights-panel.tsx`
  - Endpoints:
    - `GET /api/health`
    - `GET /api/exams`
    - `GET /api/domains`
    - `GET /api/analytics/weak-areas`
    - `GET /api/study/overview`
    - `GET /api/sessions/history`
    - `GET /api/study/history`
    - `GET /api/auth/me`
    - `POST /api/auth/login`
    - `POST /api/auth/register`
    - `POST /api/auth/logout`
    - `POST /api/sessions`
    - `POST /api/study/sessions`

- `web/app/exam/[sessionId]/page.tsx`
  - Feature: `exam-runner`
  - Componentes:
    - `web/features/session-runner/components/session-runner-shell.tsx`
  - Endpoints:
    - `GET /api/sessions/{id}`
    - `GET /api/sessions/{id}/next`
    - `POST /api/sessions/{id}/answer`

- `web/app/study/[sessionId]/page.tsx`
  - Feature: `study-runner`
  - Componentes:
    - `web/features/session-runner/components/session-runner-shell.tsx`
  - Endpoints:
    - `GET /api/study/sessions/{id}`
    - `GET /api/study/sessions/{id}/next`
    - `POST /api/study/sessions/{id}/answer`
    - `GET /api/study/questions/{question_id}/state`
    - `PUT /api/study/questions/{question_id}/state`

- `web/app/exam/[sessionId]/result/page.tsx`
  - Feature: `exam-result`
  - Componentes:
    - `web/features/results/components/session-result-shell.tsx`
  - Endpoints:
    - `GET /api/sessions/{id}/review`

- `web/app/study/[sessionId]/result/page.tsx`
  - Feature: `study-result`
  - Componentes:
    - `web/features/results/components/session-result-shell.tsx`
  - Endpoints:
    - `GET /api/study/sessions/{id}/review`

- `web/app/history/page.tsx`
  - Feature: `history`
  - Componentes:
    - `web/features/history/components/history-shell.tsx`
  - Endpoints:
    - `GET /api/exams`
    - `GET /api/sessions/history`
    - `GET /api/study/history`
    - `GET /api/study/analytics/weekly`
    - `GET /api/study/review/queue`
    - `POST /api/study/review/sessions`

- `web/app/admin/page.tsx`
  - Feature: `admin`
  - Componentes:
    - `web/features/admin/components/admin-shell.tsx`
  - Endpoints:
    - `GET /api/exams`
    - `GET /api/admin/overview`
    - `GET /api/admin/questions`
    - `GET /api/admin/questions/{question_id}`
    - `POST /api/admin/exams`
    - `POST /api/admin/questions`
    - `DELETE /api/admin/questions/{question_id}`
    - `POST /api/admin/ingest`
    - `GET /api/admin/export`

### Planejado

- Testes automatizados e refinamentos finais
