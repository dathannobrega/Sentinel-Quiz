# Backend (FastAPI)

## Rodar localmente
```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp ../.env.example .env        # o template fica na raiz do repositório
alembic upgrade head           # schema sempre via Alembic
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Precisa de um PostgreSQL (veja o `docker run` no README da raiz). Sem `APP_ENV` o backend assume `production`; o `.env.example` define `APP_ENV=development`.

## Testes
```bash
python -m pytest
# testes que precisam de Postgres rodam quando TEST_DATABASE_URL está definido:
TEST_DATABASE_URL=postgresql+psycopg://user:pass@127.0.0.1:5432/sentinel_test python -m pytest
```

## Variáveis principais
- `DATABASE_URL`: `postgresql+psycopg://sentinel:sentinel@127.0.0.1:5432/sentinel_quiz` (dev)
- `QUESTION_JSON_DIR` / `MATERIAL_DIR`: `../questions` / `../material`
- `STUDY_TRACK_DIR`: diretório com `Modulos_sec+.md` e `cissp_domain.json` (trilha de estudo). Na imagem: `/app/study-tracks`; vazio/ausente = usa `MATERIAL_DIR`
- `INGEST_ON_STARTUP`: importa os JSON no startup (ou `POST /api/admin/ingest`)
- `BOOTSTRAP_SCHEMA`: `false` (legado; proibido em produção)
- `AUTH_COOKIE_*`: cookie HttpOnly de sessão
- `RATE_LIMIT_BACKEND` / `REDIS_URL`: `memory` em dev, `redis` em produção

Lista completa e defaults: README da raiz, seção "Variáveis de ambiente".

## Migrations
- A cadeia Alembic foi consolidada em um baseline: o arquivo `alembic/versions/0008_consolidated_baseline.py` tem **revision id `0008_question_stats_snapshot`** (id do head legado, mantido por compatibilidade). As revisões seguintes começam em `0009_editorial_metadata_and_metrics`.
- Banco novo: `alembic upgrade head`.
- Banco local já existente com schema equivalente: `alembic stamp head`.
- Em containers, o entrypoint roda `alembic upgrade head` no start (`RUN_DB_MIGRATIONS=true`); o `env.py` usa advisory lock do PostgreSQL para réplicas concorrentes.
