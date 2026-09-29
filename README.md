# 🛡️ Sentinel Quiz

[![Security+](https://img.shields.io/badge/Exam-CompTIA_Security%2B-orange)]()
[![CISSP](https://img.shields.io/badge/Exam-ISC2_CISSP-red)]()
[![Powered by Gemini](https://img.shields.io/badge/AI-Gemini-blue)]()

Aplicação full-stack para simulados de certificações de cibersegurança. O banco de questões em JSON (`questions/`) é importado para PostgreSQL e servido por uma API FastAPI; o frontend Next.js oferece simulado, modo estudo, revisão espaçada e um tutor de IA (Gemini) que explica conceitos sem entregar a resposta.

## ✨ Funcionalidades Principais

* **Ingestão de questões:** importação dos arquivos JSON de `./questions/` para o banco — no start do container quando `INGEST_ON_STARTUP=true` (padrão só no compose local) ou sob demanda via `POST /api/admin/ingest` (admin). Veja [Ingestão](#-ingestão-de-questões).
* **Simulado Realista:** sessões configuráveis com feedback e insights finais.
* **Study Mode Dedicado:** blocos de aprendizado separados do simulado, com feedback imediato, nível de confiança, sessão adaptativa e agendamento de revisão.
* **Exam Mode Adaptativo:** o simulado pode priorizar revisões pendentes e domínios fracos, mantendo variedade.
* **Painel Admin:** gerenciamento de provas e questões por usuários com papel `admin`, em `/admin`.
* **Tutor IA (Gemini):** explica conceitos e dá pistas; exige login, tem cota diária e fica indisponível durante simulados em andamento.
* **Sessões Isoladas:** histórico, analytics e revisão escopados por usuário autenticado ou por dispositivo (`X-Client-Key`).
* **SRS Incremental:** a fila de revisão guarda repetições, lapsos, estabilidade e fator de facilidade.
* **Snapshots Editoriais Históricos:** snapshots por `question_version` para acompanhar dificuldade, erro e pressão de revisão ao longo do tempo.

## 🚀 Tecnologias

- **Backend:** Python 3.12, FastAPI, SQLAlchemy, Alembic, PostgreSQL 16, Redis 7 (rate limit).
- **Frontend:** Next.js (App Router), React, TypeScript — Node 22 LTS.
- **Infra:** Docker Compose (local) / Portainer (produção), nginx (TLS + headers), GitHub Actions → GHCR.
- **IA:** Google Gemini API (REST), modelo padrão `gemini-2.5-flash`.

---

## 🧭 Arquitetura

```
             :80 (redirect) / :443 (TLS)
navegador ───────────────► proxy (nginx) ──► web  (Next.js :3000)
                              │   /api/*
                              └────────────► api  (FastAPI/uvicorn :8000) ──► postgres :5432
                                                                          └─► redis    :6379
rede "edge": proxy, web, api          rede "data" (internal, sem egress): api, postgres, redis
```

Somente o proxy publica portas no host. `web`, `api`, `postgres` e `redis` não são acessíveis de fora; o frontend chama a API na mesma origem (`https://<host>/api`).

---

## 🐳 Início rápido (Docker Compose local)

```bash
cp .env.docker.example .env      # opcional: todos os valores têm default de desenvolvimento
docker compose up --build -d
```

Acesse **https://localhost** (o `http://localhost` redireciona). O certificado é autoassinado: aceite-o no navegador na primeira vez — ele é persistido no volume `proxy_certs` e **não** muda entre reinícios.

O compose local (`docker-compose.yml`):

- sobe `postgres`, `redis`, `api`, `web` e `proxy`; publica apenas as portas `APP_HTTP_PORT` (80) e `APP_HTTPS_PORT` (443);
- roda `alembic upgrade head` antes de iniciar a API (`APP_RUN_DB_MIGRATIONS=true`) e importa `./questions` uma vez no start (`APP_INGEST_ON_STARTUP=true`);
- monta `./questions` em `/questions` (read-only) para refletir mudanças sem rebuild;
- monta `./material` em `/app/material` (read-only) — os EPUBs licenciados ficam só no seu disco (ver [Materiais](#-materiais-de-referência-epub));
- usa credenciais **somente de desenvolvimento** (`sentinel`/`sentinel`) quando `.env` não define outras — o backend recusa essa senha com `APP_ENV=production`;
- limita CPU/memória de cada serviço (`APP_*_CPUS` / `APP_*_MEMORY`) e rotaciona logs (`json-file`, 10 MB × 5).

Comandos úteis:

```bash
docker compose logs -f api
docker compose run --rm api migrate      # só `alembic upgrade head`
docker compose run --rm api ingest       # só a importação de questions/*.json
docker compose exec postgres psql -U sentinel -d sentinel_quiz
```

Primeiro administrador: crie a conta pela UI e promova-a no banco:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "update users set role = '\''admin'\'' where email = '\''voce@exemplo.com'\''"'
```

---

## 🛠️ Desenvolvimento sem Docker

### Backend (FastAPI)

```bash
docker run -d --rm --name sentinel-pg \
  -e POSTGRES_DB=sentinel_quiz -e POSTGRES_USER=sentinel -e POSTGRES_PASSWORD=sentinel \
  -p 5432:5432 postgres:16-alpine

cd backend
python3.12 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
cp ../.env.example .env              # APP_ENV=development, rate limit em memória
alembic upgrade head                 # schema via migrations (BOOTSTRAP_SCHEMA=false)
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
python -m pytest                     # testes (TEST_DATABASE_URL habilita os de Postgres)
```

Sem `APP_ENV` definido o backend assume `production` (fail-closed): exige Redis, cookie `Secure`, senha de banco forte etc. O `.env.example` já define `APP_ENV=development`.

### Frontend (Next.js)

```bash
cd web
npm ci
echo "NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8000" > .env.local   # API em outra origem no dev
npm run dev        # http://127.0.0.1:3000
npm run lint && npm run typecheck && npm run build
```

---

## 🏗️ Imagens Docker

Cada imagem tem seu próprio contexto de build:

```bash
docker build -t sentinel-quiz:local .                        # API (contexto = raiz, allowlist em .dockerignore)
docker build -t sentinel-quiz-web:local web                  # frontend (contexto = web/)
docker build -t sentinel-quiz-proxy:local docker/nginx       # proxy nginx
```

- **API:** multi-stage (`builder` com venv → runtime `python:3.12-slim`), usuário não-root `app`, código read-only, healthcheck em `/api/health`. As questões (`questions/`) vão na imagem; os EPUBs **não**. A trilha de estudo também vai na imagem: **somente** `material/Modulos_sec+.md`, `material/cissp_domain.json` e `material/ceh_modules.md` (conteúdo próprio, não licenciado) são liberados na allowlist do `.dockerignore` e copiados para `/app/study-tracks` (`STUDY_TRACK_DIR=/app/study-tracks`; o backend cai para `MATERIAL_DIR` se o diretório não existir). Alterou esses arquivos? Rebuild da imagem.
- **Web:** `node:22-alpine`, `npm ci` a partir do `package-lock.json` (o build falha sem lockfile), saída `standalone`, usuário não-root.
- **Proxy:** `nginx:1.30-alpine` com TLS, `server_tokens off`, gzip, `limit_req` em `/api/auth/`. Headers de segurança sem duplicação: HSTS em tudo; nas rotas `/api` o nginx aplica `docker/nginx/api-security-headers.conf` (oculta cópias do upstream); nas páginas do Next.js os headers e a CSP vêm do próprio app (`web/next.config.mjs` + `web/middleware.ts`).
- Imagens base fixadas por digest (`@sha256:…`); o Dependabot abre PRs para atualizá-las.

`docker run` direto da API (precisa de Postgres e Redis acessíveis):

```bash
docker run -d --name sentinel-quiz \
  --env-file .env.docker.example \
  -e APP_DATABASE_URL='postgresql+psycopg://USER:SENHA@SEU_POSTGRES:5432/sentinel_quiz' \
  -e APP_REDIS_URL='redis://SEU_REDIS:6379/0' \
  -v "$PWD/material:/app/material:ro" \
  sentinel-quiz:local
```

O entrypoint exporta cada `APP_<NOME>` como `<NOME>` (valor vazio = default do backend), constrói `DATABASE_URL` a partir de `APP_POSTGRES_*` quando `APP_DATABASE_URL` está vazio e aceita `APP_ENV_FILE` apontando para um arquivo `.env` montado no container. Comandos: `api` (padrão), `migrate`, `ingest`, ou qualquer comando arbitrário.

---

## ☁️ Deploy com Portainer (produção)

Use `docker-compose.portainer.yml` como stack. Ele usa as imagens publicadas no GHCR (sem `build`) e **falha no deploy** se faltarem variáveis obrigatórias:

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `APP_IMAGE_TAG` | sim | Tag imutável publicada pelo CI: `sha-<7 chars>` (commits na `main`) ou `1.2.3` (release `v1.2.3`). Não existe `:latest` no stack. |
| `APP_POSTGRES_PASSWORD` | sim | Senha do Postgres; a API monta a `DATABASE_URL` com ela (não há como dessincronizar). Gere com `openssl rand -base64 32`. |
| `APP_NGINX_HOST` | sim | Domínio público sem protocolo (`quiz.seudominio.com`). Define `server_name`, CN/SAN do certificado, `PUBLIC_WEB_ORIGIN` e CORS. |
| `APP_IMAGE_REPOSITORY` | não | Default `ghcr.io/dathannobrega/sentinel-quiz` (web/proxy usam os sufixos `-web`/`-proxy`). |
| `APP_MATERIAL_HOST_DIR` | não | Caminho **absoluto** no host com os EPUBs (montado read-only). Vazio = volume nomeado `material_data`. |
| `APP_TLS_*` | não | Certificado próprio (ver [TLS](#-tls--certificados)). |

Demais variáveis: veja `.env.docker.example` e a [tabela abaixo](#️-variáveis-de-ambiente). Defaults do stack: `APP_ENV=production`, migrations no start, `APP_INGEST_ON_STARTUP=false`, rate limit em Redis, `pull_policy: missing` (tags são imutáveis).

Fluxo de atualização: aguarde o CI verde → copie a tag `sha-xxxxxxx` (ou a versão) do pacote no GHCR → altere `APP_IMAGE_TAG` no stack → *Update the stack*. Rollback = voltar a tag anterior (migrations destrutivas exigem restore de backup).

Primeiro deploy: suba o stack, depois importe as questões com `APP_INGEST_ON_STARTUP=true` em um redeploy (e volte para `false`) ou chame `POST /api/admin/ingest` com um admin. Se os pacotes do GHCR forem privados, cadastre o registry `ghcr.io` no Portainer com um token `read:packages`.

Materiais no volume nomeado (quando `APP_MATERIAL_HOST_DIR` está vazio):

```bash
docker run --rm -v <stack>_material_data:/dst -v /caminho/dos/epubs:/src:ro alpine cp -a /src/. /dst/
```

---

## 🗃️ Migrations

- A API roda `alembic upgrade head` **no start do container** (`RUN_DB_MIGRATIONS=true`, default nos dois composes e na imagem), antes de iniciar os workers do uvicorn. O `alembic/env.py` obtém um *advisory lock* do PostgreSQL, então réplicas iniciando juntas se serializam em vez de competir.
- `BOOTSTRAP_SCHEMA` (antigo `create_all`) fica `false` e é recusado em produção. Se você o ligar em dev, o entrypoint força 1 worker.
- Rodar manualmente / como job único: `docker compose run --rm api migrate` (ou `cd backend && alembic upgrade head`).
- A cadeia foi consolidada em um baseline: o arquivo `0008_consolidated_baseline.py` tem **revision id `0008_question_stats_snapshot`** (mantido para compatibilidade com bancos antigos). Banco novo: `alembic upgrade head`. Banco antigo com schema equivalente: `alembic stamp head` (só depois de conferir o schema).

## 📥 Ingestão de questões

- `INGEST_ON_STARTUP=true`: o entrypoint importa `questions/*.json` **uma vez** antes de subir os workers (os workers recebem `INGEST_ON_STARTUP=false`, evitando importações concorrentes). Default: `true` no compose local, `false` no Portainer e no backend.
- Sob demanda: `POST /api/admin/ingest` (usuário `admin`) ou `docker compose run --rm api ingest`.
- No Portainer as questões vêm da imagem (`/questions`); para atualizar o banco de questões publique uma nova imagem.
- **Revisão editorial pendente:** `python scripts/validate_content.py` (job `content-validate` do CI) ainda emite *warnings* conhecidos — questões sem explicação real, enunciados quase duplicados e `sim1_q043` (alternativas equivalentes). Eles não bloqueiam o CI, mas exigem revisão editorial humana (corrigir no JSON ou pelo editor do `/admin`); não há correção automática.

### Fontes externas (`questions/imports/`)

Questões de terceiros só entram pelo pipeline `python -m scripts.question_sources` (registry com licença e status de cada fonte, gate de licença, adapters, dedupe, aplicação da revisão SME e import). Só fontes `approved` geram `questions/imports/<id>.json`, sempre com proveniência e `needs_review=true`; a ingestão carrega esses arquivos depois dos bancos principais. Política, decisões atuais e passo a passo: [docs/question-sources.md](docs/question-sources.md).

### PBQs (performance-based questions)

`questions/pbq_securityplus.json` traz PBQs originais do SY0-701 (ordenar, categorizar, associar, preencher tabela, selecionar linhas de um anexo). Elas estendem o exame `securityplus` (mesmo `exam.id`). Na ingestão, o payload público é separado do gabarito privado (`app/services/pbq_grading.py`, que também documenta o formato de autoria e a correção parcial). Sessões de simulado e de estudo aceitam `pbq_count` (0–5): as PBQs vêm primeiro e contam dentro de `total_questions`.

### Notas operacionais da API

- `GET /api/sessions/{id}/questions/{position}` **persiste o cursor de navegação** do simulado (`current_position`) para retomar a sessão no mesmo ponto. É uma exceção documentada e intencional à regra de GETs somente leitura (M-B7); não trate essa rota como idempotente para cache ou prefetch.

## 📚 Materiais de referência (EPUB)

Os EPUBs são material comercial licenciado: **não** são versionados (`material/*.epub` e `*.pdf` estão no `.gitignore`), **não** entram na imagem (`material/` fica fora do contexto pela allowlist do `.dockerignore`, exceto os três arquivos da trilha de estudo — `Modulos_sec+.md`, `cissp_domain.json` e `ceh_modules.md` —, que vão para `/app/study-tracks`) e são montados em runtime, read-only, em `/app/material`:

- local: `./material:/app/material:ro`;
- Portainer: `APP_MATERIAL_HOST_DIR` (bind) ou volume `material_data`.

O preview de referências (`/api/materials/preview`) exige usuário autenticado e não há rota de download do arquivo original. Sem os arquivos o app funciona normalmente, apenas sem o preview. A **trilha de estudo** não depende desse volume (vem de `/app/study-tracks` na imagem), então funciona também no Portainer sem EPUBs.

> ⚠️ O histórico do git **ainda contém** os três EPUBs (commits anteriores a esta mudança) e imagens antigas no GHCR os incluem em `/app/material`. Veja [Limpeza do histórico](#limpeza-do-histórico-e-do-ghcr-epubs).

---

## 🔐 TLS / certificados

- **Padrão (`APP_TLS_MODE=self-signed`)**: o proxy gera um certificado autoassinado (CN/SAN = `APP_NGINX_HOST` + `APP_NGINX_ALT_NAMES`) **somente** se não existir, se expirar em menos de 30 dias ou se os nomes mudarem. Fica no volume `proxy_certs`.
- **Certificado próprio (`APP_TLS_MODE=custom`)**: nada é gerado; o proxy valida os arquivos e falha no start se estiverem ausentes.
  - Coloque `server.crt` (cadeia completa) e `server.key` em um diretório do host e aponte `APP_TLS_CERTS_DIR=/srv/sentinel/certs`; ou
  - **Let's Encrypt** (certbot no host): `APP_TLS_CERTS_DIR=/etc/letsencrypt`, `APP_TLS_CERTIFICATE=/etc/nginx/certs/live/<host>/fullchain.pem`, `APP_TLS_CERTIFICATE_KEY=/etc/nginx/certs/live/<host>/privkey.pem`. Após cada renovação: `docker exec <proxy> nginx -s reload` (ex.: `--deploy-hook` do certbot).
  - Alternativa: terminar TLS num proxy externo (Traefik/Caddy/Cloudflare) — nesse caso ajuste o nginx para confiar no IP desse proxy (`set_real_ip_from`), senão todos os clientes aparecerão com o IP do balanceador.
- HSTS (`max-age=31536000; includeSubDomains`) está ligado: use-o só em domínios que servirão HTTPS permanentemente.

## 🌐 IP do cliente e rate limit

- O nginx **sobrescreve** `X-Forwarded-For` e `X-Real-IP` com `$remote_addr` (nunca anexa o valor enviado pelo cliente) e gera `X-Request-ID` próprio.
- Uvicorn roda com `--proxy-headers --forwarded-allow-ips "$FORWARDED_ALLOW_IPS"`. Os composes usam `*` porque a API **não é publicada** e só o proxy a alcança na rede interna; a imagem, isolada, confia apenas em `127.0.0.1`. Nunca publique a porta 8000 com `*`.
- `TRUST_FORWARDED_FOR_HEADER=true` apenas atrás do proxy (composes); em dev local sem proxy fica `false`.
- Rate limit da aplicação em **Redis** (`RATE_LIMIT_BACKEND=redis`, obrigatório em produção), compartilhado entre os `UVICORN_WORKERS` (default 2). O nginx adiciona `limit_req` em `/api/auth/` (`APP_NGINX_AUTH_RATE=10r/s`, burst 20) como defesa em profundidade.

## 💾 Backup e restore

`scripts/create_logical_backup.sh` executa `pg_dump -Fc` **dentro do container do Postgres** (sem senha em argumentos, sem precisar de `pg_dump` no host), grava com `umask 077`, verifica o arquivo com `pg_restore --list`, gera `.sha256` e mantém os `BACKUP_RETENTION` (14) dumps mais recentes em `BACKUP_DIR` (`./backups`, ignorado pelo git).

```bash
./scripts/create_logical_backup.sh                                   # compose local
BACKUP_COMPOSE_ARGS="-f docker-compose.portainer.yml -p sentinel" ./scripts/create_logical_backup.sh
BACKUP_MODE=container BACKUP_PG_CONTAINER=<stack>-postgres-1 ./scripts/create_logical_backup.sh   # Portainer
BACKUP_MODE=url DATABASE_URL='postgresql://user:***@db:5432/sentinel_quiz' ./scripts/create_logical_backup.sh  # Postgres externo (senha vai para PGPASSFILE temporário)
```

Agende (cron/systemd timer) e copie os dumps para fora do host. **Restore** (teste periodicamente):

```bash
docker compose stop api web proxy
docker compose exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backups/sentinel-quiz-AAAAMMDDTHHMMSSZ.dump
docker compose start api web proxy
```

(`sha256sum -c backups/<arquivo>.dump.sha256` antes de restaurar.) Para restaurar em outro host, suba só o `postgres` do stack, rode o comando acima e depois inicie o restante — as migrations do start levam o schema até o `head` se o dump for de uma versão anterior.

---

## ⚙️ Variáveis de ambiente

- **Containers** usam nomes com prefixo `APP_` (`.env.docker.example`); o entrypoint os exporta sem o prefixo. Valor vazio = default do backend.
- **Backend rodando direto** (`backend/.env`) usa os nomes sem prefixo (`.env.example` na raiz).

| Variável (sem prefixo) | Default backend | Compose local / Portainer | Descrição |
| --- | --- | --- | --- |
| `APP_ENV` | `production` | `development` / `production` | Em `production` o backend valida a configuração e recusa defaults inseguros. Testes usam `test`. |
| `ENFORCE_PRODUCTION_SAFETY` | `true` | `true` | Liga as validações de produção. |
| `RUN_DB_MIGRATIONS` | — (entrypoint `true`) | `true` | `alembic upgrade head` no start do container. |
| `BOOTSTRAP_SCHEMA` | `false` | `false` | `create_all` legado; proibido em produção. |
| `INGEST_ON_STARTUP` | `false` | `true` / `false` | Importa `questions/*.json` uma vez no start. |
| `DATABASE_URL` | — | montada de `APP_POSTGRES_*` | Via `APP_DATABASE_URL` só para banco externo. |
| `APP_POSTGRES_DB` / `_USER` / `_PASSWORD` | — | `sentinel_quiz` / `sentinel` / dev: `sentinel`, prod: **obrigatória** | Credenciais do serviço postgres (e da URL da API). |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_TIMEOUT` | `10` / `10` / `10` | — | Pool do SQLAlchemy (por worker). |
| `UVICORN_WORKERS` | — (entrypoint `2`) | `2` | Processos uvicorn. |
| `FORWARDED_ALLOW_IPS` | — (entrypoint `127.0.0.1`) | `*` | IPs dos quais o uvicorn aceita `X-Forwarded-*`. |
| `TRUST_FORWARDED_FOR_HEADER` | `false` | `true` | Usa o IP que o nosso nginx colocou em `X-Forwarded-For`. |
| `TRUST_REQUEST_ID_HEADER` | `true` | `true` | Reaproveita o `X-Request-ID` (gerado pelo nginx). |
| `EXPOSE_API_DOCS` | `false` em produção | vazio | `/docs` e `/openapi.json`. |
| `QUESTION_JSON_DIR` / `MATERIAL_DIR` | `../questions` / `../material` | `/questions` / `/app/material` | Caminhos de conteúdo. |
| `PUBLIC_WEB_ORIGIN` | `http://127.0.0.1:3000` | `https://<APP_NGINX_HOST>` | Base dos links de e-mail. |
| `CORS_ORIGINS` | localhost | `https://<APP_NGINX_HOST>` | `*` é recusado em produção. |
| `AUTH_COOKIE_SECURE` / `_SAMESITE` / `_DOMAIN` / `_NAME` | — | `true` / `lax` / vazio / `sentinel_session` | Cookie HttpOnly de sessão. |
| `AUTH_TOKEN_TTL_HOURS` / `AUTH_TOKEN_BYTES` | `168` / `32` | — | Validade/entropia do token de sessão. |
| `AUTH_RETURN_TOKEN_IN_BODY` | `false` | — | Devolve o token no JSON de login (só clientes legados). |
| `AUTH_LAST_USED_THROTTLE_SECONDS` | `300` | — | Frequência máxima de atualização de `last_used_at`. |
| `AUTH_EMAIL_VERIFICATION_TTL_MINUTES` / `AUTH_PASSWORD_RESET_TTL_MINUTES` | `1440` / `60` | — | Validade dos links de e-mail. |
| `SMTP_HOST` / `_PORT` / `_USERNAME` / `_PASSWORD` / `_FROM_EMAIL` / `_FROM_NAME` / `_USE_TLS` | vazio / `587` / … / `true` | — | Envio de e-mail (reset/verificação). |
| `LOG_LEVEL` / `LOG_JSON` / `SLOW_REQUEST_THRESHOLD_MS` | `INFO` / `true` / `1200` | — | Logs estruturados. |
| `RATE_LIMIT_BACKEND` / `REDIS_URL` | `memory` / vazio | `redis` / `redis://redis:6379/0` | `redis` é obrigatório em produção. |
| `RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION` | `false` | — | Escape explícito (instância única). |
| `RATE_LIMIT_ENABLED`, `RATE_LIMIT_{PUBLIC,AUTH,ADMIN}_{REQUESTS,WINDOW_SECONDS}`, `RATE_LIMIT_CACHE_SIZE` | `true`, 180/60, 40/60, 60/60, 50000 | — | Limites por bucket. |
| `ABUSE_*` | ver `.env.docker.example` | — | Sinais de scraping/abuso. |
| `GEMINI_ENABLE` / `GEMINI_API_KEY` / `GEMINI_MODEL` | `true` / vazio / `gemini-2.5-flash` | — | Tutor IA (sem chave = tutor desligado). |
| `GEMINI_TIMEOUT_SECONDS`, `_TEMPERATURE`, `_MAX_OUTPUT_TOKENS`, `_SYSTEM_PROMPT`, `_MIN_RESPONSE_CHARS`, `_RETRY_ON_SHORT`, `_CANDIDATE_COUNT` | `20`, `0.2`, `400`, vazio, `220`, `true`, `1` | — | Ajustes do tutor. |
| `TUTOR_DAILY_QUOTA` | `40` | — | Pedidos ao tutor por usuário/dia. |
| `AUTH_SLIDING_SESSION` | `true` | — | Renova a validade do token de sessão quando já passou metade do TTL. |
| `STUDY_TRACK_DIR` | `/app/study-tracks` (imagem) | — | Pasta com `Modulos_sec+.md`, `cissp_domain.json` e `ceh_modules.md` (trilha de estudo); cai para `MATERIAL_DIR`. |
| `DB_POOL_PRE_PING` | `true` | — | Testa a conexão antes de usar (evita conexões mortas). |
| `AUTH_VERIFICATION_RESEND_COOLDOWN_SECONDS` | `60` | — | Intervalo mínimo entre reenvios do e-mail de verificação. |
| `SMTP_TIMEOUT_SECONDS` | `20` | — | Timeout do envio SMTP (roda em background). |
| `RATE_LIMIT_AUTH_SENSITIVE_REQUESTS` / `RATE_LIMIT_AUTH_SENSITIVE_WINDOW_SECONDS` | `10` / `60` | — | Bucket extra para cadastro/reset/verificação. |
| `GEMINI_THINKING_BUDGET` | `0` | — | Orçamento de "thinking" do Gemini 2.5 (0 = desligado). |

Somente da stack (não viram configuração da API): `APP_IMAGE_TAG`, `APP_IMAGE_REPOSITORY`, `APP_*_CONTAINER_NAME`, `APP_HTTP_PORT`, `APP_HTTPS_PORT`, `APP_NGINX_HOST`, `APP_NGINX_ALT_NAMES`, `APP_NGINX_CERT_DAYS`, `APP_NGINX_AUTH_RATE`, `APP_NGINX_AUTH_BURST`, `APP_NGINX_CLIENT_MAX_BODY_SIZE`, `APP_TLS_MODE`, `APP_TLS_CERTS_DIR`, `APP_TLS_CERTIFICATE`, `APP_TLS_CERTIFICATE_KEY`, `APP_MATERIAL_HOST_DIR`, `APP_*_CPUS`, `APP_*_MEMORY`.

**Frontend:** `APP_PUBLIC_API_ORIGIN` → `NEXT_PUBLIC_API_ORIGIN` e `API_ORIGIN` no container `web`. Deixe **vazio** para usar a mesma origem do proxy (`https://<host>/api`); preencha só para apontar para outra API. O valor é lido em runtime pelo layout do servidor; em `npm run dev` use `web/.env.local`.

**Frontend (runtime, container `web`):**

| Variável do stack | Variável no `web` | Default | Descrição |
| --- | --- | --- | --- |
| `APP_AUTH_COOKIE_NAME` | `AUTH_COOKIE_NAME` | `sentinel_session` | Cookie de sessão verificado pela guarda do `/admin` no `middleware.ts` (lido a cada request, não no build). Deve ser igual ao `AUTH_COOKIE_NAME` da API — os composes usam a mesma variável para os dois. |
| `APP_TUTOR_CLIENT_TIMEOUT_MS` | `TUTOR_CLIENT_TIMEOUT_MS` | `45000` | Timeout do navegador nas chamadas ao tutor de IA, injetado por request em `window.__SENTINEL_RUNTIME__`. Aceita 5000–300000; fora disso usa 45000. Mantenha acima de `GEMINI_TIMEOUT_SECONDS` (+ retry). |

**Frontend (dev/opcional):** `BACKEND_ORIGIN` (destino do rewrite `/api` no `next dev`, padrão `http://127.0.0.1:8000`) e `ADMIN_ROUTE_GUARD` (`auto`/`on`/`off`, guarda de rota do `/admin` no `middleware.ts`). Veja `web/.env.example`.

---

## 🔁 CI/CD

`.github/workflows/ci.yml` roda em todo PR e push:

| Job | O que faz |
| --- | --- |
| `backend-tests` | Python 3.12, `pip install -r backend/requirements.txt -r backend/requirements-dev.txt`, `pytest` em `backend/` com serviço `postgres:16` (`TEST_DATABASE_URL`), e `pip-audit -r backend/requirements.txt`. |
| `content-validate` | `python scripts/validate_content.py` (validação do banco de questões). |
| `web-checks` | Node 22, `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build` em `web/`. |
| `image-scan` | Build das 3 imagens (sem push) + Trivy; falha com vulnerabilidade **CRITICAL** corrigível. |
| `publish` | Só em push para `main`, tags `v*` ou dispatch manual, e só se todos os jobs acima passarem (`needs`). Publica `ghcr.io/<owner>/<repo>`, `-web` e `-proxy`. |

Tags publicadas: `sha-<7 chars>` sempre; `X.Y.Z` e `X.Y` em tags `vX.Y.Z`; `latest` **somente** em tags de release. Build apenas `linux/amd64` (sem QEMU). Todas as actions estão fixadas por SHA de commit (comentário com a versão) e o `.github/dependabot.yml` atualiza pip, npm, imagens Docker (Dockerfiles e composes) e actions.

---

## 🔒 Notas de segurança

- **Credenciais:** `sentinel/sentinel` existe apenas como default de desenvolvimento no compose local; o stack do Portainer exige `APP_POSTGRES_PASSWORD` e o backend recusa essa senha em produção. Segredos (`APP_POSTGRES_PASSWORD`, `APP_SMTP_PASSWORD`, `APP_GEMINI_API_KEY`) devem ficar nas variáveis do stack, nunca no repositório.
- **Superfície exposta:** só o proxy publica portas; Postgres/Redis ficam numa rede interna sem egress; imagens rodam como não-root; o nginx não expõe versão (`server_tokens off`).
- **Headers:** cada header aparece uma única vez. O nginx envia HSTS em todas as respostas; em `/api` também `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` e `Permissions-Policy` (ocultando cópias do backend). Nas páginas, esses mesmos valores (+ `Cross-Origin-Opener-Policy`) e a **Content-Security-Policy** com nonce (`frame-ancestors 'none'`) são emitidos pelo Next.js (`web/next.config.mjs`, `web/middleware.ts`). Ao mudar um valor, altere os dois lugares.
- **Sessões anônimas (`X-Client-Key`):** ao fazer login/cadastro enviando o mesmo `X-Client-Key`, as sessões anônimas daquele dispositivo são associadas à conta. Quem conhecer o `X-Client-Key` de outro dispositivo pode reivindicar o progresso anônimo dele — risco aceito porque sessões anônimas não contêm dados pessoais; o valor é aleatório, gerado e guardado apenas no navegador.
- **Autenticação:** cookie HttpOnly `sentinel_session` (`Secure` atrás do proxy); o token não é devolvido no corpo por padrão (`AUTH_RETURN_TOKEN_IN_BODY=false`).

### Limpeza do histórico e do GHCR (EPUBs)

Esta mudança parou de versionar os EPUBs, mas **commits antigos ainda os contêm** e **imagens já publicadas** (todas as tags anteriores) os carregam em `/app/material`. Reescrever o histórico é destrutivo e deve ser feito por quem administra o repositório:

```bash
# 0. requisitos: git-filter-repo >= 2.47 (pip install git-filter-repo); avise colaboradores
# 1. clone novo e dedicado
git clone https://github.com/<owner>/Sentinel-Quiz.git sentinel-quiz-purge
cd sentinel-quiz-purge
# 2. remover os EPUBs de todo o histórico (todos os branches e tags)
git filter-repo --sensitive-data-removal --invert-paths --path-glob '*.epub'
# 3. conferir (as duas saídas devem ser vazias)
git log --all --oneline -- '*.epub'
git rev-list --objects --all | grep -i '\.epub$'
# 4. publicar o histórico reescrito (readicione o remote se o filter-repo o removeu)
git remote get-url origin || git remote add origin https://github.com/<owner>/Sentinel-Quiz.git
git push --force --mirror origin
```

Depois: (a) peça ao GitHub Support a remoção de objetos em cache/PRs antigos (refs `refs/pull/*` não são reescritos por push); (b) todos os colaboradores devem **reclonar** (não fazer merge de clones antigos); (c) forks existentes continuam com os arquivos.

GHCR — confirme que os pacotes não são públicos e apague versões antigas que contêm os EPUBs:

```bash
gh api /users/<owner>/packages/container/sentinel-quiz --jq .visibility        # deve ser "private"
gh api --paginate /user/packages/container/sentinel-quiz/versions \
  --jq '.[] | [.id, (.metadata.container.tags | join(",")), .created_at] | @tsv'
gh api -X DELETE /user/packages/container/sentinel-quiz/versions/<id>          # versões anteriores a esta mudança
```

(Ou em *GitHub → Packages → sentinel-quiz → Package settings → Change visibility / Manage versions*. Para organizações, troque `/user/` por `/orgs/<org>/`.)

---

## 📂 Estrutura de Dados

O formato canônico é um JSON por certificação:

1. `questions/securityplus.json`
2. `questions/cissp.json`
3. `questions/ceh.json` (CEH v13: banco original conceitual, 5 questões por módulo M01–M20, todas `ai_draft` com `needs_review=true` até a revisão SME; domínios e pesos do blueprint v5.0 da EC-Council; nota de corte praticada 70% — a oficial varia de 60% a 85% por forma de prova)
4. `questions/pbq_securityplus.json` (PBQs do Security+, ver acima) e `questions/imports/*.json` (fontes externas aprovadas)

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

Os campos `domain`, `difficulty`, `certification`, `tags` e `citations` alimentam os insights por área, dificuldade, certificação e o plano de estudo.

## 🧳 Migrando um banco SQLite legado

O runtime usa apenas PostgreSQL (SQLite é recusado em produção). Para migrar dados antigos:

```bash
python scripts/migrate_sqlite_to_postgres.py \
  --source sqlite:///./backend/securityplus.db \
  --target postgresql+psycopg://sentinel:sentinel@127.0.0.1:5432/sentinel_quiz
```

O destino deve estar no schema atual (`alembic upgrade head`). Um backup de SQLite é apenas a cópia do arquivo `.db` com a aplicação parada.

## 🔌 API — endpoints de autenticação e estudo

- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Estudo: `GET /api/study/overview`, `GET|PUT /api/study/questions/{question_id}/state`, `POST /api/study/sessions`, `POST /api/study/review/sessions`, `GET /api/study/review/queue`, `GET /api/study/history`, `GET /api/study/analytics/weekly`, `GET /api/study/sessions/{session_id}`, `GET /api/study/sessions/{session_id}/next`, `POST /api/study/sessions/{session_id}/answer`, `GET /api/study/sessions/{session_id}/review`.
- Admin: `POST /api/admin/ingest` e demais rotas em `/api/admin/*` (papel `admin`).

Com `EXPOSE_API_DOCS=true` (default fora de produção) a referência completa fica em `/docs`.
