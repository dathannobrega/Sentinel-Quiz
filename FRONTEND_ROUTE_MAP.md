# Frontend Route Map

## Estado atual

- `frontend/index.html`
  - Home/dashboard
  - Auth inline
  - Start session
  - Quiz runner
  - Result
  - History
  - Study history
  - Review modals
- `frontend/admin.html`
  - CMS editorial

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

### Planejado

- `web/app/history/page.tsx`
  - Feature: `history`
  - Endpoints:
    - `GET /api/sessions/history`
    - `GET /api/study/history`
    - `GET /api/study/analytics/weekly`

- `web/app/study/[sessionId]` (estado de estudo inline)
  - Feature: `study-state`
  - Endpoints:
    - `GET /api/study/questions/{question_id}/state`
    - `PUT /api/study/questions/{question_id}/state`

- `web/app/admin/page.tsx`
  - Feature: `admin`
  - Endpoints:
    - `GET /api/admin/overview`
    - `GET /api/admin/questions`
    - `POST /api/admin/...`
