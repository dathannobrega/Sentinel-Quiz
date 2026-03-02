# Backend (FastAPI)

## Rodar
```bash
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Variáveis
- QUESTION_JSON_DIR: pasta contendo JSONs
- DATABASE_URL: postgresql+psycopg://sentinel:sentinel@127.0.0.1:5432/sentinel_quiz
- AUTH_COOKIE_*: configura o cookie HttpOnly de sessao
- BOOTSTRAP_SCHEMA: habilite apenas para dev/local

## Migrations
- A cadeia Alembic foi consolidada em um baseline unico (compatível com o head legado): `0008_question_stats_snapshot`
- Para banco novo: `alembic upgrade head`
- Para banco local ja existente com schema equivalente: `alembic stamp head`
