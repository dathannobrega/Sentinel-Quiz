# 🛡️ Sentinel Quiz

[![Security+](https://img.shields.io/badge/Exam-CompTIA_Security%2B-orange)]()
[![CISSP](https://img.shields.io/badge/Exam-ISC2_CISSP-red)]()
[![Powered by Gemini](https://img.shields.io/badge/AI-Gemini_Pro-blue)]()

Uma aplicação full-stack moderna para simulados de certificações de cibersegurança. O sistema transforma dados JSON em um ambiente de prova dinâmico com o suporte de um tutor de IA que foca no aprendizado conceitual sem entregar a resposta.

## ✨ Funcionalidades Principais

* **Ingestão Dinâmica:** Importação automática de arquivos JSON (`./questions/`) para SQLite no startup.
* **Simulado Realista:** Interface SPA configurada para 90 questões com feedback imediato e insights finais.
* **Painel Admin:** Gerenciamento de provas e questões via API Key.
* **Tutor IA (Gemini):** Integração com Google Gemini para explicar conceitos e dar pistas, garantindo que o usuário aprenda o "porquê" em vez de apenas decorar.

## 🚀 Tecnologias

- **Backend:** Python, FastAPI, SQLAlchemy, SQLite.
- **Frontend:** JavaScript (Vanilla/SPA), CSS3, HTML5.
- **IA:** Google Generative AI SDK.

---

## 🛠️ Instalação e Execução

### 1. Backend (FastAPI)
O backend é responsável por processar os JSONs e servir a API.

```bash
cd backend
python -m venv .venv

# Ativação do ambiente virtual
# Windows: .venv\Scripts\activate | Linux/Mac: source .venv/bin/activate

pip install -r requirements.txt
cp ../.env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

```

### 2. Frontend

Para o frontend, você pode usar qualquer servidor estático.

```bash
cd frontend
# Utilizando o servidor nativo do Python para testes rápidos
python -m http.server 5500

```

Acesse em: `http://127.0.0.1:5500`

### 3. Docker / Docker Compose

Para subir a aplicação completa em container:

```bash
cp .env.docker.example .env
docker compose up --build -d
```

A aplicação ficará disponível em `http://127.0.0.1:8000`.

O compose local:
- usa defaults seguros mesmo sem `.env`
- aceita sobrescrita por `.env`
- monta `./questions` em `/questions` para refletir mudanças sem rebuild
- persiste o SQLite no volume `db_data`

### 4. Docker Run Direto

Também é possível rodar a imagem manualmente:

```bash
docker build -t sentinel-quiz:local .
docker run -d \
  --name sentinel-quiz \
  -p 8000:8000 \
  --env-file .env.docker.example \
  -v sentinel_quiz_data:/data \
  sentinel-quiz:local
```

Se quiser montar um arquivo `.env` dentro do container, defina `APP_ENV_FILE` apontando para esse caminho montado.

### 5. Portainer

Para Portainer, use `docker-compose.portainer.yml` como stack base:

- troque `APP_IMAGE_NAME` para a imagem publicada no registry
- configure as variáveis `APP_*` no painel do stack
- mantenha o volume `db_data` para persistência

Esse arquivo usa imagem pronta (sem `build`) e é mais adequado para ambientes gerenciados.

---

## ⚙️ Configurações (.env)

O projeto depende de variáveis de ambiente para funcionar corretamente:

| Variável | Descrição |
| --- | --- |
| `ADMIN_API_KEY` | Chave para acessar `frontend/admin.html`. |
| `GEMINI_API_KEY` | Sua chave de API do Google AI Studio. |
| `GEMINI_MODEL` | Modelo utilizado (ex: `gemini-1.5-flash`). |
| `GEMINI_TEMPERATURE` | Criatividade da IA (recomendado: 0.4 para exatidão). |

> **Nota sobre o Tutor:** O prompt do sistema está configurado para nunca revelar a alternativa correta diretamente, agindo estritamente como um mentor acadêmico.

Para containers, prefira usar as variáveis `APP_*` descritas em `.env.docker.example`; o `docker-compose.yml` converte essas variáveis para o runtime interno da aplicação.

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
