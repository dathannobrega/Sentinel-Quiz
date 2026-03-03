# 🛡️ Sentinel Quiz

[![Security+](https://img.shields.io/badge/Exam-CompTIA_Security%2B-orange)]()
[![CISSP](https://img.shields.io/badge/Exam-ISC2_CISSP-red)]()
[![Powered by Gemini](https://img.shields.io/badge/AI-Gemini_Pro-blue)]()

Uma aplicação full-stack moderna para simulados de certificações de cibersegurança. O sistema transforma dados JSON em um ambiente de prova dinâmico com o suporte de um tutor de IA que foca no aprendizado conceitual sem entregar a resposta.

## ✨ Funcionalidades Principais

* **Ingestão Dinâmica:** Importação automática de arquivos JSON (`./questions/`) para banco SQL no startup.
* **Simulado Realista:** Interface SPA configurada para 90 questões com feedback imediato e insights finais.
* **Study Mode Dedicado:** Blocos de aprendizado separados do simulado, com feedback imediato, nível de confiança, sessão adaptativa e agendamento de revisão.
* **Exam Mode Adaptativo:** O simulado também pode priorizar revisões pendentes e domínios fracos, mantendo distribuição suficiente para não virar apenas “revisão disfarçada”.
* **Painel Admin Modernizado:** Gerenciamento de provas e questões via sessão autenticada com papel `admin`, agora também disponível no frontend Next em `/admin`.
* **Auth Separada no Frontend:** Login e cadastro agora possuem páginas dedicadas (`/login`, `/register`) e o dashboard principal vive em `/dashboard`.
* **Tutor IA (Gemini):** Integração com Google Gemini para explicar conceitos e dar pistas, garantindo que o usuário aprenda o "porquê" em vez de apenas decorar.
* **Sessões Isoladas:** Histórico, analytics e revisão ficam escopados por usuário autenticado ou por dispositivo (`X-Client-Key`) para evitar vazamento de progresso entre alunos.
* **Conta e Estado de Estudo:** Login/cadastro web com sincronização de bookmarks e notas por questão, inclusive com migração automática do progresso local ao entrar na conta.
* **Revisão Diária e Histórico de Estudo:** A fila de revisão pode gerar blocos dedicados e a aplicação mantém histórico próprio de estudo, separado do histórico de simulados.
* **Métricas Semanais e Revisão Profunda:** O painel inicial mostra ritmo semanal de estudo/revisão e cada bloco de estudo concluído pode ser reaberto com revisão detalhada por questão.
* **SRS Incremental:** A fila de revisão agora guarda repetições, lapsos, estabilidade e fator de facilidade para espaçar o retorno de cada questão de forma mais próxima de um SRS real.
* **Snapshots Editoriais Históricos:** O admin pode registrar snapshots por `question_version` para acompanhar como dificuldade, erro e pressão de revisão evoluem ao longo do tempo.

## 🚀 Tecnologias

- **Backend:** Python, FastAPI, SQLAlchemy, PostgreSQL/SQLite, Alembic.
- **Frontend:** Next.js (App Router), React e TypeScript como interface principal.
- **IA:** Google Generative AI SDK.

---

## 🛠️ Instalação e Execução

### 1. Backend (FastAPI)
O backend é responsável por processar os JSONs e servir a API.

```bash
docker run --rm --name sentinel-pg \
  -e POSTGRES_DB=sentinel_quiz \
  -e POSTGRES_USER=sentinel \
  -e POSTGRES_PASSWORD=sentinel \
  -p 5432:5432 postgres:16-alpine

cd backend
python -m venv .venv

# Ativação do ambiente virtual
# Windows: .venv\Scripts\activate | Linux/Mac: source .venv/bin/activate

pip install -r requirements.txt
cp ../.env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

```

O runtime principal agora assume `PostgreSQL`. `SQLite` ficou restrito a cenários legados e migração assistida. Como a aplicação ainda não entrou em produção, a trilha de migrations foi consolidada em um único baseline Alembic alinhado ao schema atual. Em produção, prefira rodar migrations com Alembic e manter `BOOTSTRAP_SCHEMA=false`.

### 2. Frontend (Next)

O frontend principal agora vive em `web/`.

```bash
cd web
npm install
npm run dev
```

Acesse em: `http://127.0.0.1:3000`

### 3. Docker / Docker Compose

Para subir a aplicação completa em container:

```bash
cp .env.docker.example .env
docker compose up --build -d
```

A stack ficará disponível em:

- frontend Next: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:8000`

O compose local:
- usa defaults seguros mesmo sem `.env`
- aceita sobrescrita por `.env`
- sobe `PostgreSQL`, API e frontend Next por padrão
- monta `./questions` em `/questions` para refletir mudanças sem rebuild
- monta `./material` externamente em `/app/material` (os EPUBs nao vao mais baked na imagem)
- persiste o Postgres no volume `postgres_data`
- permite `APP_RUN_DB_MIGRATIONS=true` para executar `alembic upgrade head` antes do `uvicorn`
- já expõe logs estruturados JSON, `X-Request-ID` e sinais básicos de abuso no backend

### 4. Docker Run Direto

Também é possível rodar a imagem manualmente:

```bash
docker build -t sentinel-quiz:local .
docker run -d \
  --name sentinel-quiz \
  -p 8000:8000 \
  -e DATABASE_URL=postgresql+psycopg://sentinel:sentinel@SEU_POSTGRES:5432/sentinel_quiz \
  -e BOOTSTRAP_SCHEMA=false \
  -e RUN_DB_MIGRATIONS=true \
  sentinel-quiz:local
```

Se quiser montar um arquivo `.env` dentro do container, ele deve usar as variáveis reais da aplicação (`DATABASE_URL`, `AUTH_COOKIE_*`, etc.). Depois monte esse arquivo e defina `APP_ENV_FILE` apontando para o caminho interno montado.
Para `docker run` com SQLite em vez de Postgres, mantenha o default de `DATABASE_URL` e monte `-v sentinel_quiz_data:/data`.
O entrypoint também entende variáveis prefixadas com `APP_`, então você pode reaproveitar `.env.docker.example` em `docker run` se preferir esse formato.

Para o frontend Next:

```bash
docker build -f web/Dockerfile -t sentinel-quiz-web:local .
docker run -d \
  --name sentinel-quiz-web \
  -p 3000:3000 \
  -e NEXT_PUBLIC_API_ORIGIN=http://localhost:8000 \
  sentinel-quiz-web:local
```

### 5. Portainer

Para Portainer, use `docker-compose.portainer.yml` como stack base:

- troque `APP_IMAGE_NAME`, `APP_WEB_IMAGE_NAME` e `APP_NGINX_IMAGE_NAME` para as imagens publicadas no registry
- configure as variáveis `APP_*` no painel do stack
- publique o app pelo proxy em `APP_NGINX_HOST`; a API passa a sair em `http(s)://<host>/api`
- o proxy gera um certificado autoassinado no startup usando `APP_NGINX_HOST` como `CN/SAN`
- mantenha o volume `postgres_data` para persistência do banco
- mantenha também `proxy_certs` se quiser persistir a chave/certificado entre reinícios
- monte também o diretório/volume de `material` externamente se quiser preview de referência no app
- para schema controlado por migration, use `APP_BOOTSTRAP_SCHEMA=false` e `APP_RUN_DB_MIGRATIONS=true`
- o default dessa stack já assume `APP_ENV=production`; se o banco for `sqlite`, a API vai recusar o boot por segurança

Esse arquivo usa imagens prontas (sem `build`) e é mais adequado para ambientes gerenciados.

### 6. Backup Lógico

Para gerar um backup manual do banco:

```bash
DATABASE_URL="postgresql+psycopg://sentinel:sentinel@localhost:5432/sentinel_quiz" \
./scripts/create_logical_backup.sh
```

O script suporta `PostgreSQL` (via `pg_dump`) e `SQLite` (cópia consistente do arquivo). O objetivo é fornecer um caminho operacional imediato; em produção, ainda é recomendável agendar essa rotina e testar restore periodicamente.

### 7. Migrando um Banco SQLite Legado

Se voce ainda tiver um banco antigo em `SQLite`, migre os dados para `PostgreSQL` antes de seguir usando a aplicacao:

```bash
python scripts/migrate_sqlite_to_postgres.py \
  --source sqlite:///./backend/securityplus.db \
  --target postgresql+psycopg://sentinel:sentinel@127.0.0.1:5432/sentinel_quiz
```

Como o baseline Alembic foi consolidado, um banco local ja existente pode ser:

1. recriado do zero, ou
2. receber `alembic stamp head` depois de voce confirmar que o schema atual ja corresponde aos `models`.

---

## ⚙️ Configurações (.env)

O projeto depende de variáveis de ambiente para funcionar corretamente:

| Variável | Descrição |
| --- | --- |
| `DATABASE_URL` | String de conexão do banco (`sqlite:///...` ou `postgresql+psycopg://...`). |
| `APP_ENV` | Ambiente lógico (`development` ou `production`). Em `production`, o backend valida configurações inseguras antes de iniciar. |
| `BOOTSTRAP_SCHEMA` | Quando `true`, cria/atualiza o schema base automaticamente no startup. Em produção, prefira `false` com Alembic. |
| `AUTH_TOKEN_TTL_HOURS` | Validade dos tokens bearer opacos. |
| `AUTH_TOKEN_BYTES` | Entropia usada na geração dos tokens bearer. |
| `AUTH_COOKIE_*` | Define o cookie HttpOnly de sessão (`sentinel_session`), usado pelo frontend novo em vez de `localStorage`. |
| `LOG_LEVEL` | Nível de log do backend (`INFO`, `WARNING`, etc.). |
| `LOG_JSON` | Quando `true`, emite logs estruturados em JSON, próprios para agregadores e observabilidade. |
| `SLOW_REQUEST_THRESHOLD_MS` | Limite a partir do qual requests lentos viram warning no log. |
| `RATE_LIMIT_*` | Limites por bucket (`public`, `auth`, `admin`). |
| `ABUSE_*` | Sensibilidade dos sinais de scraping/abuso emitidos pelo backend. |
| `GEMINI_API_KEY` | Sua chave de API do Google AI Studio. |
| `GEMINI_MODEL` | Modelo utilizado (ex: `gemini-1.5-flash`). |
| `GEMINI_TEMPERATURE` | Criatividade da IA (recomendado: 0.4 para exatidão). |

> **Nota sobre o Tutor:** O prompt do sistema está configurado para nunca revelar a alternativa correta diretamente, agindo estritamente como um mentor acadêmico.

Para containers, prefira usar as variáveis `APP_*` descritas em `.env.docker.example`; o `docker-compose.yml` converte essas variáveis para o runtime interno da aplicação.

### Autenticação e Escopo

Os endpoints de autenticação disponíveis são:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Os endpoints de estado de estudo disponíveis são:

- `GET /api/study/overview`
- `GET /api/study/questions/{question_id}/state`
- `PUT /api/study/questions/{question_id}/state`
- `POST /api/study/sessions`
- `POST /api/study/review/sessions`
- `GET /api/study/review/queue`
- `GET /api/study/history`
- `GET /api/study/analytics/weekly`
- `GET /api/study/sessions/{session_id}`
- `GET /api/study/sessions/{session_id}/next`
- `POST /api/study/sessions/{session_id}/answer`
- `GET /api/study/sessions/{session_id}/result`
- `GET /api/study/sessions/{session_id}/review`

O frontend web agora gera e envia automaticamente `X-Client-Key` em todas as chamadas, isolando histórico e métricas por dispositivo quando o aluno ainda não criou conta. A autenticacao principal do app web passou a usar cookie HttpOnly (`AUTH_COOKIE_NAME`) com `credentials: include`; o token bearer ficou apenas como compatibilidade transitória e nao e mais persistido em `localStorage`.

No `study mode`, o payload de criação de sessão também aceita `strategy=standard|adaptive`. No `exam mode`, `POST /api/sessions` também aceita `strategy=standard|adaptive` para priorizar domínios fracos e revisões sem perder variedade do simulado. A rota dedicada `POST /api/study/review/sessions` usa a fila de revisão como fonte principal e pode complementar com itens futuros quando necessário. A política de revisão agora também considera repetições, lapsos, fator de facilidade e estabilidade para espaçar melhor os próximos retornos.

Além da tela de login dedicada, você ainda pode integrar autenticação via navegador com o helper global:

```js
window.SentinelAuth.setToken("SEU_TOKEN");
window.SentinelAuth.getClientKey();
```

Ao fazer `login` ou `register` com o mesmo `X-Client-Key`, as sessões anônimas daquele dispositivo são automaticamente associadas ao usuário.
O mesmo fluxo também consolida bookmarks e notas salvas localmente para a conta autenticada.
Agora esse merge também preserva sessões de estudo e itens da fila de revisão daquele dispositivo.

---

## 📂 Estrutura de Dados

O formato canônico da plataforma agora é um JSON por certificação:

1. `questions/securityplus.json`
2. `questions/cissp.json`

Ambos usam o mesmo schema rico:
```json
{
  "exam": {
    "id": "securityplus",
    "title": "CompTIA Security+ - Banco de Questoes",
    "source": "Normalized from legacy files",
    "question_count": 726,
    "certification": "Security+",
    "schema_version": 2
  },
  "questions": [
    {
      "id": "sim1_q001",
      "question": "Enunciado",
      "multi_select": false,
      "domain": "Security Architecture",
      "difficulty": "Medium",
      "certification": "Security+",
      "tags": ["vpn", "remote access"],
      "cross_domain_tags": ["General Security Concepts"],
      "question_type": "single_response",
      "format_type": "scenario_based",
      "citations": [
        { "source": "CompTIA Security+ SY0-701 Objectives", "reference": "Security Architecture" }
      ],
      "source_materials": ["material/Modulos_sec+.md"],
      "options": [
        { "key": "A", "text": "Opcao A" },
        { "key": "B", "text": "Opcao B" }
      ],
      "correct_options": ["B"],
      "justification": "Explicacao"
    }
  ]
}
```

Os campos `domain`, `difficulty`, `certification`, `tags` e `citations` alimentam os insights por área, dificuldade, certificação e o plano de estudo com recomendações de “o que revisar” e “onde revisar”.

`questions/cissp.dump` mantém apenas os itens não-CISSP que ficaram fora do arquivo canônico do CISSP.

---

## 🚢 Build e Publish

O workflow `/.github/workflows/docker-publish.yml` faz build e publish da imagem Docker no GHCR:

- em `push` para `main`
- em tags `v*`
- manualmente via `workflow_dispatch`

As tags geradas incluem branch, tag, SHA e `latest` na branch padrão.

## 🗃️ Migrations

O projeto agora inclui Alembic em `backend/alembic/` com uma migration baseline para autenticação e escopo de sessões.

```bash
cd backend
alembic upgrade head
```

Fluxo recomendado em produção:

1. Definir `DATABASE_URL` para PostgreSQL.
2. Rodar `alembic upgrade head`.
3. Subir a aplicação com `BOOTSTRAP_SCHEMA=false`.

---

## 🌐 Frontend Next.js

O frontend do produto agora vive integralmente em `web/`, com:

- `Next.js (App Router)`
- `React`
- `TypeScript`
- `apiClient` tipado para os endpoints reais do backend
- tokens visuais e componentes base reutilizáveis

Primeira fatia já entregue:

- dashboard inicial
- login/cadastro/logout
- visão de áreas fracas
- overview de estudo
- criação de sessão (`exam` e `study`)
- runner de prova (`/exam/[sessionId]`)
- runner de study (`/study/[sessionId]`)
- tela de resultado e revisão básica de ambos
- histórico e analytics principais (`/history`)
- bookmark e nota inline por questão no `study mode`
- painel editorial completo (`/admin`)

Para subir essa nova UI:

```bash
cd web
npm install
npm run dev
```

Se o backend não estiver na mesma origem, defina:

```bash
NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8000
```

## 🐳 Docker com Proxy + API + Web

O `docker-compose.yml` agora sobe:

1. `proxy` em `http://localhost`, redirecionando para `https://localhost` com certificado autoassinado
2. `web` internamente na porta `3000`
3. `api` internamente na porta `8000`, publicada externamente em `/api`

Fluxo local:

```bash
docker compose up --build
```

Acesse a interface por `https://localhost` (ou `http://localhost`, que redireciona). O frontend usa a mesma origem para chamar `/api`, então não é mais necessário expor `web` e `api` diretamente no host.

Variáveis principais para o proxy/runtime:

```bash
APP_NGINX_HOST=localhost
APP_NGINX_ALT_NAMES=
APP_NGINX_CERT_DAYS=3650
APP_PUBLIC_WEB_ORIGIN=
APP_PUBLIC_API_ORIGIN=
```

`APP_NGINX_HOST` deve receber apenas o host/domínio, sem `http://` ou `https://`.
Se `APP_PUBLIC_WEB_ORIGIN` ficar vazio, a API deriva automaticamente `https://<APP_NGINX_HOST>`.

Quando estiver em produção com domínio público, use:

```bash
APP_NGINX_HOST=quiz.seudominio.com
APP_NGINX_ALT_NAMES=www.quiz.seudominio.com
APP_PUBLIC_WEB_ORIGIN=https://quiz.seudominio.com
APP_AUTH_COOKIE_SECURE=true
```

O certificado continua sendo autoassinado; o navegador vai exigir confiança manual ou importação da CA/chave em ambientes controlados.
Deixe `APP_PUBLIC_API_ORIGIN` vazio para o frontend usar a mesma origem do proxy. Só preencha esse valor se quiser forçar chamadas para outro backend.

No Portainer, a stack agora espera tres imagens:

1. `APP_IMAGE_NAME` para a API
2. `APP_WEB_IMAGE_NAME` para o frontend Next
3. `APP_NGINX_IMAGE_NAME` para o proxy Nginx

O workflow `docker-publish.yml` deve publicar as tres imagens no GHCR:

1. `ghcr.io/<owner>/<repo>` (API)
2. `ghcr.io/<owner>/<repo>-web` (frontend)
3. `ghcr.io/<owner>/<repo>-proxy` (Nginx)
