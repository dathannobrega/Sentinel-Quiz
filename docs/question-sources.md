# Fontes externas de questões

Este documento define como o Sentinel-Quiz avalia e importa questões de terceiros. O
pipeline fica em `scripts/question_sources/` e o estado de cada fonte avaliada fica em
`scripts/question_sources/registry.json`.

## Política

Uma fonte só pode ser importada quando cumpre as três condições abaixo.

1. **Licença explícita que permita reutilizar o conteúdo** (identificador SPDX: MIT,
   Apache-2.0, BSD, CC-BY, CC0...) **ou permissão escrita do autor**.
   - Um repositório sem arquivo `LICENSE` está sob "todos os direitos reservados", mesmo
     que o README cite "MIT".
   - A licença do repositório só vale para o conteúdo que o autor tem o direito de licenciar.
2. **Nada de dumps nem de material comercial.**
   - Dumps são enunciados reais de prova (ExamTopics etc.), protegidos pelo NDA do
     candidato (EC-Council, CompTIA, ISC2).
   - Material comercial inclui livros e simulados pagos, como ExamsDigest.
   - Uma fonte com esse tipo de conteúdo fica `blocked`, qualquer que seja a licença do
     repositório.
3. **Revisão por SME (especialista no assunto).**
   - Toda questão importada entra com `needs_review=true` e com a proveniência completa
     (`source_repo`, `source_commit`, `source_license`, `source_path`, `source_id`).
   - Ela só vale como conteúdo aprovado depois que um editor a revisa no admin.

Status no registry:

| status | significado | pode importar? |
|---|---|---|
| `approved` | licença de reuso ou permissão escrita registrada | sim |
| `permission_required` | sem licença utilizável; vale pedir permissão ao autor | só com `--permission-evidence` |
| `blocked` | conteúdo copiado de dumps ou de material comercial, ou fonte sem valor | nunca |

Uma fonte `blocked` só volta a ser avaliada com uma nova decisão, feita por PR que altere o
`registry.json` e revisada por outra pessoa. A permissão do autor do repositório não
resolve conteúdo que ele copiou de terceiros.

**Nunca commite conteúdo extraído de terceiros.**
- `fetch` e `extract` escrevem só no cache, fora do repositório: `~/.cache/sentinel-quiz/sources`,
  ou o diretório de `SQ_SOURCES_CACHE`. O pipeline recusa um cache dentro do repo.
- Só o comando `import` escreve no repositório (`questions/imports/<id>.json`), e só para
  fontes `approved`.
- Os testes usam fixtures sintéticas.

### Decisões atuais (2026-09-29)

| fonte | licença | status | motivo |
|---|---|---|---|
| michaliskampouridis-security-plus-study | nenhuma | approved | o dono informou a permissão do autor; revisão completa de 535: 89% corretas, 0 gabaritos errados; 476 importadas em `questions/imports/` |
| iakhator-comptia-security-plus-701 | nenhuma (MIT só no README) | approved | o dono informou a permissão do autor; revisão completa de 400: 81,8% corretas, 9 gabaritos corrigidos; 336 importadas em `questions/imports/` |
| costajr007-security-plus-practice | MIT | personal_use | conteúdo copiado do material comercial ExamsDigest ("ExamsDigest Corp" em 7 enunciados, números de página de PDF até 1331); o dono autorizou uso privado de estudo; 481 revisadas e importadas em `questions/local/` |
| psybeast-ceh-v13-exam-simulator | MIT | personal_use | enunciados copiados literalmente de dumps ExamTopics do CEH v11 (NDA da EC-Council); o dono autorizou uso privado de estudo e assumiu o risco; 353 revisadas e importadas em `questions/local/` |
| therrpatil-ceh-v13-exam-mcq135 | nenhuma | blocked | sem licença; só em PDF; qualidade baixa (realismo 1,7) |
| siriusbkid-gideon-pbq-generator | nenhuma | blocked | sem licença; inclui `SC300_Exam_BrainDump.pdf`; gera cenários de IAM/IoT com um LLM local e não tem PBQs de Security+ |

Os números agregados da revisão (sem conteúdo) ficam em `review_stats` no registry.

## Como obter permissão

1. Abra uma issue ou mande um e-mail ao autor e peça autorização escrita. A autorização
   precisa dizer:
   - qual repositório e qual commit;
   - que o uso é no Sentinel-Quiz, com atribuição;
   - que as questões podem ser adaptadas (tradução, correção de gabarito, explicações
     novas);
   - que a redistribuição dentro da plataforma está incluída.
2. Salve a resposta como arquivo: o e-mail em `.eml`, o PDF ou o texto da issue com o link.
3. Rode o import informando a evidência:
   `import <id> --permission-evidence <arquivo> --note "..."`.
   Esse comando faz três coisas:
   - copia a evidência para `scripts/question_sources/permissions/<id>/`;
   - grava o sha256 e a data em `permission` no registry;
   - muda o status para `approved`.
4. Commite o registry e a evidência junto com `questions/imports/<id>.json`.

## Uso pessoal de estudo (`personal_use`)

Para fontes sem direito de redistribuição que o dono do sistema decidiu usar só no próprio
estudo privado e não comercial:

1. `import <id> --personal-use --authorization <arquivo> --note "..."` registra a
   autorização (em `personal_use` no registry, preservando o motivo original do bloqueio
   em `blocked_reason`) e muda o status para `personal_use`.
2. O import vai para `questions/local/<id>.json`, pasta ignorada pelo git e pelo build
   do Docker: o conteúdo nunca é commitado nem entra em imagens publicadas. Cada questão
   leva `usage_restriction: "personal_use"`.
3. O ingest lê `questions/local/*.json` depois de `imports/`. No compose local a pasta
   já chega via `./questions`. No Portainer, aponte `APP_LOCAL_QUESTIONS_HOST_DIR` para a
   pasta no host (ou preencha o volume `local_questions`).
4. Mantenha uma cópia de `questions/local/` fora do repositório; ela não está no git.

## Como rodar

Rode os comandos a partir da raiz do repositório. Basta Python 3.10+ (stdlib) e `git`;
`pdftotext` só é necessário para fontes em PDF.

```bash
python -m scripts.question_sources list -v                  # fontes, licença, status e motivo
python -m scripts.question_sources fetch <id>               # git clone no commit fixado (cache)
python -m scripts.question_sources extract <id>             # adapter -> <cache>/<id>/extracted.json
python -m scripts.question_sources validate <arquivo>       # schema v3 + proveniência (exit 1 se houver erro)
python -m scripts.question_sources dedupe <arquivo>         # contra questions/*.json: exato + difflib >= 0.9
python -m scripts.question_sources review-apply <arquivo> <review.json> --out <cache>/<id>/reviewed.json
python -m scripts.question_sources import <id>              # só fontes approved -> questions/imports/<id>.json
```

- **Adapters** (`adapters.py`): um por formato de fonte, `secplus_mk`, `secplus_ia`,
  `secplus_cj`, `ceh_psybeast`, `ceh_rrpatil` e `gideon`. O gideon não é um banco de
  questões, então o adapter dele recusa a extração.
  - Cada adapter gera registros no schema v3 (`scripts/validate_content.py`), com
    `needs_review=true` e proveniência.
  - O domínio vem do mapeamento da fonte (número do domínio do SY0-701, módulo do CEH).
  - Quando a fonte não tem domínio, o adapter usa um placeholder e registra o motivo em
    `review_notes`.
- **Review** (`review-apply`): usa o formato de `REVIEW_INSTRUCTIONS`, com os campos
  `id`, `verdict`, `correct_options`, `reasoning`, `realism`, `objective`, `domain`,
  `difficulty`, `explanation_ok` e `ai_explanation`.
  - `incorrect_key` corrige o gabarito.
  - `ambiguous`, `outdated`, `off_topic` e `poor_quality` são descartadas; use
    `--keep-flagged` para mantê-las.
  - Uma explicação nova escrita por IA entra como `explanation_source: "ai_draft"`.
  - Todo item continua com `needs_review=true`.
- **Import**: aplica o gate de licença, remove duplicatas do banco (exatas e fuzzy) e
  valida. Se houver qualquer erro, nada é gravado.
  - O arquivo gerado usa o `exam_id` da certificação (`securityplus`, `ceh`). Assim as
    questões entram nos simulados daquele exame.
  - A ingestão carrega `questions/*.json` e depois `questions/imports/*.json`.
  - Vários arquivos podem estender o mesmo exame: a contagem e a desativação de questões
    removidas usam a união dos arquivos.
- **CI**:
  - `scripts/validate_content.py` valida também `questions/imports/*.json` e exige a
    proveniência completa.
  - O teste `test_no_extracted_third_party_content_is_committed` falha se existir um
    import de uma fonte que não esteja `approved`.
