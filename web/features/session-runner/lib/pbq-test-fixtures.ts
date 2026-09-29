/**
 * Test-only PBQ payloads (served shape, i.e. the authoring format without solution/explanation/
 * scoring). Mix contract spellings (`type`, `lines`, `input_type`) and authoring spellings
 * (`kind`, `rows`, `input`) on purpose: the renderer must accept both.
 */
import type { PbqFeedbackFields, PbqPayload } from "@/types/api";

export const ORDERING_PAYLOAD: PbqPayload = {
  title: "Resposta a incidentes",
  scenario: "O EDR alertou um ransomware no servidor de arquivos.",
  exhibits: [],
  tasks: [
    {
      id: "t1",
      type: "ordering",
      weight: 2,
      prompt: "Ordene as fases.",
      items: [
        { id: "c", text: "Contenção" },
        { id: "p", text: "Preparação" },
        { id: "d", text: "Detecção" }
      ]
    }
  ]
};

export const CATEGORIZATION_PAYLOAD: PbqPayload = {
  title: "Classificar controles",
  scenario: "Classifique cada controle.",
  tasks: [
    {
      id: "t1",
      type: "categorization",
      weight: 1,
      prompt: "Arraste cada controle para o tipo.",
      buckets: [
        { id: "prev", label: "Preventivo" },
        { id: "det", label: "Detectivo" }
      ],
      items: [
        { id: "k1", text: "Bloqueio de conta" },
        { id: "k2", text: "Alerta do SIEM" }
      ]
    }
  ]
};

export const MATCHING_PAYLOAD: PbqPayload = {
  title: "Associar indicadores",
  tasks: [
    {
      id: "t1",
      type: "matching",
      prompt: "Associe cada evidência ao ataque.",
      allow_reuse: false,
      left: [
        { id: "i1", text: "' OR '1'='1" },
        { id: "i2", text: "../../etc/passwd" }
      ],
      right: [
        { id: "a_sqli", text: "SQL injection" },
        { id: "a_trav", text: "Directory traversal" },
        { id: "a_xss", text: "XSS" }
      ]
    }
  ]
};

export const TABLE_FORM_PAYLOAD: PbqPayload = {
  title: "Risco quantitativo",
  tasks: [
    {
      id: "t1",
      type: "table_form",
      prompt: "Complete a tabela.",
      columns: [
        { id: "src", label: "Origem", input: "select", choices: ["ANY", "10.10.50.0/24"] },
        { id: "act", label: "Ação", input_type: "select", choices: ["ALLOW", "DENY"] },
        { id: "val", label: "Valor", input: "number_or_select", choices_by_row: true }
      ],
      rows: [
        {
          id: "r1",
          label: "Regra 1",
          cells: { src: { editable: true }, act: { value: "ALLOW" }, val: { editable: true, input: "number" } }
        },
        {
          id: "r2",
          label: "Regra 2",
          cells: { src: { value: "ANY" }, act: { editable: true }, val: { editable: true, choices: ["Implementar", "Não implementar"] } }
        }
      ]
    }
  ]
};

export const SELECT_IN_EXHIBIT_PAYLOAD: PbqPayload = {
  title: "Investigação de auth.log",
  scenario: "Analise o trecho do log.",
  exhibits: [
    {
      id: "e1",
      kind: "log",
      title: "Anexo 1 - auth.log",
      rows: [
        { id: "l01", text: "Failed password for invalid user admin from 203.0.113.66" },
        { id: "l02", text: "Accepted password for deploy from 203.0.113.66" },
        { id: "l03", text: "Accepted publickey for ops from 10.0.5.20" }
      ]
    },
    {
      id: "e2",
      type: "table",
      title: "Anexo 2 - Conexões",
      columns: ["#", "Origem"],
      rows: [
        { id: "c1", cells: ["1", "203.0.113.7"] },
        { id: "c2", cells: ["2", "10.10.50.14"] }
      ]
    },
    { id: "e3", type: "text", title: "Anexo 3 - Requisitos", content: "R1. Somente HTTPS." }
  ],
  tasks: [
    { id: "t1", type: "select_in_exhibit", exhibit_id: "e1", select_mode: "multiple", prompt: "Selecione as linhas maliciosas." },
    { id: "t2", type: "select_in_exhibit", exhibit_id: "e2", select_mode: "single", prompt: "Selecione a conexão bloqueada." }
  ]
};

/** Grading of ORDERING_PAYLOAD after answering [c, p, d] (solution: p, d, c). */
export const ORDERING_FEEDBACK: PbqFeedbackFields = {
  format: "pbq",
  score: 0.33,
  points_earned: 1,
  points_possible: 3,
  task_results: [{ task_id: "t1", score: 0.33, is_correct: false }],
  pbq_solution: { t1: { order: ["p", "d", "c"] } },
  pbq_explanations: { t1: { summary: "Preparação vem antes da detecção.", per_item: { c: "Contenção vem depois." } } }
};
