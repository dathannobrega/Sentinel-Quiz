# 🛡️ Sentinel Quiz

[![Security+](https://img.shields.io/badge/Exam-CompTIA_Security%2B-orange)]()
[![CISSP](https://img.shields.io/badge/Exam-ISC2_CISSP-red)]()
[![Powered by Gemini](https://img.shields.io/badge/AI-Gemini_Pro-blue)]()

Uma aplicação full-stack moderna para simulados de certificações de cibersegurança. O sistema transforma dados JSON em um ambiente de prova dinâmico com o suporte de um tutor de IA que foca no aprendizado conceitual sem entregar a resposta.

## ✨ Funcionalidades Principais

* **Ingestão Dinâmica:** Importação automática de arquivos JSON (`./questions/`) para banco SQL no startup (`SQLite` em dev ou `PostgreSQL` em produção).
* **Simulado Realista:** Interface SPA configurada para 90 questões com feedback imediato e insights finais.
* **Study Mode Dedicado:** Blocos de aprendizado separados do simulado, com feedback imediato, nível de confiança, sessão adaptativa e agendamento de revisão.
* **Exam Mode Adaptativo:** O simulado também pode priorizar revisões pendentes e domínios fracos, mantendo distribuição suficiente para não virar apenas “revisão disfarçada”.
* **Painel Admin:** Gerenciamento de provas e questões via API Key ou usuário autenticado com papel editorial.
* **Tutor IA (Gemini):** Integração com Google Gemini para explicar conceitos e dar pistas, garantindo que o usuário aprenda o "porquê" em vez de apenas decorar.
* **Sessões Isoladas:** Histórico, analytics e revisão ficam escopados por usuário autenticado ou por dispositivo (`X-Client-Key`) para evitar vazamento de progresso entre alunos.
* **Conta e Estado de Estudo:** Login/cadastro web com sincronização de bookmarks e notas por questão, inclusive com migração automática do progresso local ao entrar na conta.
* **Revisão Diária e Histórico de Estudo:** A fila de revisão pode gerar blocos dedicados e a aplicação mantém histórico próprio de estudo, separado do histórico de simulados.
* **Métricas Semanais e Revisão Profunda:** O painel inicial mostra ritmo semanal de estudo/revisão e cada bloco de estudo concluído pode ser reaberto com revisão detalhada por questão.
* **SRS Incremental:** A fila de revisão agora guarda repetições, lapsos, estabilidade e fator de facilidade para espaçar o retorno de cada questão de forma mais próxima de um SRS real.

## 🚀 Tecnologias

- **Backend:** Python, FastAPI, SQLAlchemy, PostgreSQL/SQLite, Alembic.
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

Por padrão, o backend faz bootstrap automático do schema (`BOOTSTRAP_SCHEMA=true`) para acelerar o ambiente local. Em produção, prefira rodar migrations com Alembic e desabilitar esse bootstrap.

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
- sobe `PostgreSQL` junto com a API por padrão
- monta `./questions` em `/questions` para refletir mudanças sem rebuild
- persiste o Postgres no volume `postgres_data`
- permite `APP_RUN_DB_MIGRATIONS=true` para executar `alembic upgrade head` antes do `uvicorn`

### 4. Docker Run Direto

Também é possível rodar a imagem manualmente:

```bash
docker build -t sentinel-quiz:local .
docker run -d \
  --name sentinel-quiz \
  -p 8000:8000 \
  -e DATABASE_URL=postgresql+psycopg://sentinel:sentinel@SEU_POSTGRES:5432/sentinel_quiz \
  -e ADMIN_API_KEY=change-me \
  -e BOOTSTRAP_SCHEMA=false \
  -e RUN_DB_MIGRATIONS=true \
  sentinel-quiz:local
```

Se quiser montar um arquivo `.env` dentro do container, ele deve usar as variáveis reais da aplicação (`DATABASE_URL`, `ADMIN_API_KEY`, etc.). Depois monte esse arquivo e defina `APP_ENV_FILE` apontando para o caminho interno montado.
Para `docker run` com SQLite em vez de Postgres, mantenha o default de `DATABASE_URL` e monte `-v sentinel_quiz_data:/data`.
O entrypoint também entende variáveis prefixadas com `APP_`, então você pode reaproveitar `.env.docker.example` em `docker run` se preferir esse formato.

### 5. Portainer

Para Portainer, use `docker-compose.portainer.yml` como stack base:

- troque `APP_IMAGE_NAME` para a imagem publicada no registry
- configure as variáveis `APP_*` no painel do stack
- mantenha o volume `postgres_data` para persistência do banco
- para schema controlado por migration, use `APP_BOOTSTRAP_SCHEMA=false` e `APP_RUN_DB_MIGRATIONS=true`

Esse arquivo usa imagem pronta (sem `build`) e é mais adequado para ambientes gerenciados.

---

## ⚙️ Configurações (.env)

O projeto depende de variáveis de ambiente para funcionar corretamente:

| Variável | Descrição |
| --- | --- |
| `DATABASE_URL` | String de conexão do banco (`sqlite:///...` ou `postgresql+psycopg://...`). |
| `BOOTSTRAP_SCHEMA` | Quando `true`, cria/atualiza o schema base automaticamente no startup. Em produção, prefira `false` com Alembic. |
| `ADMIN_API_KEY` | Chave para acessar `frontend/admin.html`. |
| `AUTH_TOKEN_TTL_HOURS` | Validade dos tokens bearer opacos. |
| `AUTH_TOKEN_BYTES` | Entropia usada na geração dos tokens bearer. |
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

O frontend web agora gera e envia automaticamente `X-Client-Key` em todas as chamadas, isolando histórico e métricas por dispositivo quando o aluno ainda não criou conta. Se houver um token armazenado, ele também envia `Authorization: Bearer <token>`.

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
