# Backend (FastAPI)

## Rodar
```bash
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Variáveis
- QUESTION_JSON_DIR: pasta contendo JSONs
- DATABASE_URL: sqlite:///./securityplus.db
- ADMIN_API_KEY: chave para endpoints /api/admin/*
