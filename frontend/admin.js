function resolveApiOrigin(){
  if(window.API_ORIGIN) return window.API_ORIGIN;
  if(window.location.protocol === "file:" || window.location.port === "5500"){
    return "http://127.0.0.1:8000";
  }
  return window.location.origin;
}

const API_BASE = resolveApiOrigin();
const el = (id) => document.getElementById(id);
const EXAM_SELECT_EMPTY = "";

let examItems = [];
let questionItems = [];
let selectedQuestionId = null;
let searchTimer = null;

function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getKey(){
  const k = el("adminKey").value || localStorage.getItem("adminKey") || "";
  if(k) localStorage.setItem("adminKey", k);
  return k;
}

function setNotice(id, msg){
  const node = el(id);
  if(node) node.textContent = msg || "";
}

async function apiGet(path, admin=false){
  const headers = {};
  if(admin) headers["X-Admin-Key"] = getKey();
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path, body, admin=true){
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      ...(admin ? {"X-Admin-Key": getKey()} : {})
    },
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiDelete(path, admin=true){
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: admin ? { "X-Admin-Key": getKey() } : {}
  });
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

function renderInfoCards(targetId, items){
  const wrap = el(targetId);
  wrap.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "insight-card";
    card.innerHTML = `
      <div class="label">${escapeHtml(item.label)}</div>
      <div class="value">${escapeHtml(item.value)}</div>
    `;
    wrap.appendChild(card);
  });
}

function renderOverview(data){
  const breakdown = data?.question_breakdown || {};
  const certSummary = Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label}: ${count}`)
    .join(" | ") || "-";

  renderInfoCards("overviewCards", [
    { label: "Provas", value: String(data?.exam_count ?? 0) },
    { label: "Questoes", value: String(data?.question_count ?? 0) },
    { label: "Sessoes concluidas", value: String(data?.completed_session_count ?? 0) },
    { label: "Distribuicao", value: certSummary }
  ]);
}

function renderExamSelectOptions(){
  const targets = [
    { id: "examSelectAdmin", emptyLabel: "Selecione uma prova" },
    { id: "browserExam", emptyLabel: "Todas as provas" },
    { id: "qExamId", emptyLabel: "Selecione a prova" }
  ];

  targets.forEach((target) => {
    const node = el(target.id);
    if(!node) return;
    const current = node.value;
    node.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = EXAM_SELECT_EMPTY;
    empty.textContent = target.emptyLabel;
    node.appendChild(empty);

    examItems.forEach((exam) => {
      const opt = document.createElement("option");
      opt.value = exam.id;
      opt.textContent = `${exam.title} (${exam.id})`;
      node.appendChild(opt);
    });

    if(current && examItems.some((exam) => exam.id === current)){
      node.value = current;
    }else{
      node.value = EXAM_SELECT_EMPTY;
    }
  });
}

async function loadOverview(){
  try{
    const data = await apiGet("/api/admin/overview", true);
    renderOverview(data);
  }catch(e){
    renderInfoCards("overviewCards", [
      { label: "Painel", value: "Informe a API key" }
    ]);
  }
}

async function loadExams(){
  try{
    examItems = await apiGet("/api/exams", false);
  }catch(e){
    examItems = [];
  }
  renderExamSelectOptions();
}

function summarizePrompt(text){
  const value = String(text || "").trim();
  if(value.length <= 140) return value;
  return `${value.slice(0, 140)}...`;
}

function renderQuestionList(){
  const wrap = el("questionList");
  wrap.innerHTML = "";
  questionItems.forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `question-item${item.id === selectedQuestionId ? " is-active" : ""}`;
    row.dataset.id = item.id;
    row.innerHTML = `
      <div class="qid">${escapeHtml(item.id)} · ${escapeHtml(item.exam_id)}</div>
      <div class="qprompt">${escapeHtml(summarizePrompt(item.prompt))}</div>
      <div class="qmeta">
        ${item.certification ? `<span class="mini-chip">${escapeHtml(item.certification)}</span>` : ""}
        ${item.domain ? `<span class="mini-chip">${escapeHtml(item.domain)}</span>` : ""}
        ${item.difficulty ? `<span class="mini-chip">${escapeHtml(item.difficulty)}</span>` : ""}
        <span class="mini-chip">${item.correct_count}/${item.option_count} corretas</span>
        <span class="mini-chip">${item.multi_select ? "multi" : "single"}</span>
      </div>
    `;
    wrap.appendChild(row);
  });
}

async function loadQuestionList(){
  const search = (el("questionSearch").value || "").trim();
  const examId = el("browserExam").value || "";
  const params = new URLSearchParams();
  params.set("limit", "200");
  if(search) params.set("search", search);
  if(examId) params.set("exam_id", examId);

  try{
    questionItems = await apiGet(`/api/admin/questions?${params.toString()}`, true);
    setNotice("questionListMeta", `${questionItems.length} questao(oes) carregada(s).`);
    renderQuestionList();
  }catch(e){
    questionItems = [];
    renderQuestionList();
    setNotice("questionListMeta", "Informe uma API key valida para listar questoes.");
  }
}

function nextOptionKey(){
  const keys = Array.from(document.querySelectorAll(".optKey"))
    .map((node) => (node.value || "").trim().toUpperCase())
    .filter(Boolean);
  for(let i = 0; i < 26; i += 1){
    const key = String.fromCharCode(65 + i);
    if(!keys.includes(key)) return key;
  }
  return "";
}

function addOptRow(key="", text="", isCorrect=false){
  const finalKey = key || nextOptionKey();
  const wrap = document.createElement("div");
  wrap.className = "optrow";
  wrap.innerHTML = `
    <input class="optKey" type="text" placeholder="A" value="${escapeHtml(finalKey)}" />
    <input class="optText" type="text" placeholder="Texto da alternativa" value="${escapeHtml(text)}" />
    <label class="flag"><input class="optCorrect" type="checkbox" ${isCorrect ? "checked" : ""} /> Correta</label>
    <button class="btn btn-ghost smallbtn" type="button" aria-label="Remover alternativa">X</button>
  `;
  wrap.querySelector("button").addEventListener("click", () => {
    wrap.remove();
    renderQuestionInsights();
  });
  wrap.querySelector(".optKey").addEventListener("input", (ev) => {
    ev.target.value = (ev.target.value || "").toUpperCase();
    renderQuestionInsights();
  });
  wrap.querySelector(".optText").addEventListener("input", renderQuestionInsights);
  wrap.querySelector(".optCorrect").addEventListener("change", renderQuestionInsights);
  el("opts").appendChild(wrap);
  renderQuestionInsights();
}

function addCitationRow(citationOrSource="", maybeReference=""){
  const citation = (citationOrSource && typeof citationOrSource === "object" && !Array.isArray(citationOrSource))
    ? citationOrSource
    : { source: citationOrSource, reference: maybeReference };
  const source = citation.source || "";
  const reference = citation.reference || "";
  const extra = {};
  Object.entries(citation || {}).forEach(([key, value]) => {
    if(key === "source" || key === "reference") return;
    if(value === null || value === undefined) return;
    extra[key] = value;
  });
  const wrap = document.createElement("div");
  wrap.className = "citation-row";
  if(Object.keys(extra).length){
    wrap.dataset.extra = JSON.stringify(extra);
  }
  wrap.dataset.originalSource = source;
  wrap.dataset.originalReference = reference;
  wrap.innerHTML = `
    <input class="citeSource" type="text" placeholder="Fonte" value="${escapeHtml(source)}" />
    <input class="citeReference" type="text" placeholder="Referencia" value="${escapeHtml(reference)}" />
    <button class="btn btn-ghost smallbtn" type="button" aria-label="Remover referencia">X</button>
  `;
  wrap.querySelector("button").addEventListener("click", () => {
    wrap.remove();
    renderQuestionInsights();
  });
  wrap.querySelector(".citeSource").addEventListener("input", renderQuestionInsights);
  wrap.querySelector(".citeReference").addEventListener("input", renderQuestionInsights);
  el("citations").appendChild(wrap);
  renderQuestionInsights();
}

function collectOptions(){
  return Array.from(el("opts").querySelectorAll(".optrow"))
    .map((row) => ({
      key: row.querySelector(".optKey").value.trim().toUpperCase(),
      text: row.querySelector(".optText").value.trim(),
      is_correct: row.querySelector(".optCorrect").checked
    }))
    .filter((item) => item.key && item.text);
}

function collectTags(){
  const raw = (el("qTags").value || "").split(",");
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    const text = item.trim();
    if(!text) return;
    const key = text.toLowerCase();
    if(seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out;
}

function collectCitations(){
  const out = [];
  const seen = new Set();
  Array.from(el("citations").querySelectorAll(".citation-row")).forEach((row) => {
    const source = row.querySelector(".citeSource").value.trim();
    const reference = row.querySelector(".citeReference").value.trim();
    if(!source && !reference) return;
    const citation = { source, reference };
    const originalSource = row.dataset.originalSource || "";
    const originalReference = row.dataset.originalReference || "";
    if(source === originalSource && reference === originalReference && row.dataset.extra){
      try{
        const extra = JSON.parse(row.dataset.extra);
        if(extra && typeof extra === "object" && !Array.isArray(extra)){
          Object.entries(extra).forEach(([key, value]) => {
            if(value === null || value === undefined) return;
            citation[key] = value;
          });
        }
      }catch(e){
        // Ignore malformed preserved metadata and keep visible fields only.
      }
    }
    const key = JSON.stringify(citation);
    if(seen.has(key)) return;
    seen.add(key);
    out.push(citation);
  });
  return out;
}

function buildQuestionPayload(){
  const options = collectOptions();
  const correctKeys = options.filter((opt) => opt.is_correct).map((opt) => opt.key);
  const manualMulti = el("qMulti").value === "true";
  const multiSelect = manualMulti || correctKeys.length > 1;
  return {
    id: el("qId").value.trim(),
    exam_id: el("qExamId").value.trim(),
    prompt: el("qPrompt").value.trim(),
    multi_select: multiSelect,
    domain: el("qDomain").value.trim() || null,
    difficulty: el("qDifficulty").value || null,
    certification: el("qCertification").value.trim() || null,
    tags: collectTags(),
    citations: collectCitations(),
    options,
    correct_keys: correctKeys,
    justification: el("qJust").value.trim() || null
  };
}

function renderQuestionInsights(){
  const payload = buildQuestionPayload();
  const uniqueKeys = new Set(payload.options.map((opt) => opt.key));
  renderInfoCards("questionStats", [
    { label: "Alternativas", value: String(payload.options.length) },
    { label: "Corretas", value: String(payload.correct_keys.length) },
    { label: "Tags", value: String(payload.tags.length) },
    { label: "Referencias", value: String(payload.citations.length) },
    { label: "Formato", value: payload.multi_select ? "Multi-select" : "Single-select" },
    { label: "Chaves unicas", value: uniqueKeys.size === payload.options.length ? "Sim" : "Nao" }
  ]);
  el("questionPreview").textContent = JSON.stringify(payload, null, 2);
  el("btn-delete-q").disabled = !payload.id;
}

function clearExam(){
  el("examId").value = "";
  el("examTitle").value = "";
  el("examSource").value = "";
  el("examCount").value = "";
  el("examSelectAdmin").value = EXAM_SELECT_EMPTY;
  setNotice("examNotice", "");
}

function clearQuestion({ preserveExam=true } = {}){
  const preferredExam = preserveExam ? (el("browserExam").value || el("qExamId").value || "") : "";
  selectedQuestionId = null;
  el("qLookupId").value = "";
  el("qId").value = "";
  el("qPrompt").value = "";
  el("qJust").value = "";
  el("qTags").value = "";
  el("qDomain").value = "";
  el("qDifficulty").value = "";
  el("qCertification").value = "";
  el("qMulti").value = "false";
  el("opts").innerHTML = "";
  el("citations").innerHTML = "";
  if(preferredExam){
    el("qExamId").value = preferredExam;
  }else{
    el("qExamId").value = EXAM_SELECT_EMPTY;
  }
  addOptRow("A", "");
  addOptRow("B", "");
  addOptRow("C", "");
  addOptRow("D", "");
  addCitationRow("", "");
  setNotice("qNotice", "");
  renderQuestionList();
  renderQuestionInsights();
}

function populateQuestionForm(question){
  selectedQuestionId = question.id;
  el("qLookupId").value = question.id || "";
  el("qId").value = question.id || "";
  el("qExamId").value = question.exam_id || EXAM_SELECT_EMPTY;
  el("qPrompt").value = question.prompt || "";
  el("qJust").value = question.justification || "";
  el("qMulti").value = question.multi_select ? "true" : "false";
  el("qDomain").value = question.domain || "";
  el("qDifficulty").value = question.difficulty || "";
  el("qCertification").value = question.certification || "";
  el("qTags").value = Array.isArray(question.tags) ? question.tags.join(", ") : "";

  el("opts").innerHTML = "";
  (question.options || []).forEach((opt) => addOptRow(opt.key, opt.text, opt.is_correct));
  if((question.options || []).length === 0){
    addOptRow("A", "");
    addOptRow("B", "");
    addOptRow("C", "");
    addOptRow("D", "");
  }

  el("citations").innerHTML = "";
  if(Array.isArray(question.citations) && question.citations.length){
    question.citations.forEach((citation) => addCitationRow(citation));
  }else{
    addCitationRow("", "");
  }

  renderQuestionList();
  renderQuestionInsights();
}

async function saveExam(){
  setNotice("examNotice", "");
  try{
    const payload = {
      id: el("examId").value.trim(),
      title: el("examTitle").value.trim(),
      source: el("examSource").value.trim() || null,
      question_count: el("examCount").value ? parseInt(el("examCount").value, 10) : null
    };
    if(!payload.id || !payload.title){
      setNotice("examNotice", "Preencha ID e titulo.");
      return;
    }
    await apiPost("/api/admin/exams", payload, true);
    setNotice("examNotice", "Prova salva.");
    await loadExams();
    await loadOverview();
    el("examSelectAdmin").value = payload.id;
    el("qExamId").value = payload.id;
  }catch(e){
    setNotice("examNotice", `Erro: ${e.message}`);
  }
}

async function ingest(){
  setNotice("ingestResult", "Reimportando...");
  try{
    const out = await apiPost("/api/admin/ingest", {}, true);
    setNotice("ingestResult", `Importado: ${out.imported} | Pulado: ${out.skipped} | Erros: ${(out.errors || []).length}`);
    await loadOverview();
    await loadExams();
    await loadQuestionList();
  }catch(e){
    setNotice("ingestResult", `Erro: ${e.message}`);
  }
}

async function exportDb(){
  setNotice("ingestResult", "Exportando...");
  try{
    const res = await fetch(`${API_BASE}/api/admin/export`, {
      headers: { "X-Admin-Key": getKey() }
    });
    if(!res.ok) throw new Error(await res.text());

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const cd = res.headers.get("content-disposition") || "";
    const match = cd.match(/filename=\"?([^\";]+)\"?/i);
    const filename = match ? match[1] : "sentinel_export.json";
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice("ingestResult", "Exportacao concluida.");
  }catch(e){
    setNotice("ingestResult", `Erro: ${e.message}`);
  }
}

function validateQuestionPayload(payload){
  if(!payload.id) return "ID da questao e obrigatorio.";
  if(!payload.exam_id) return "Selecione a prova.";
  if(!payload.prompt) return "Pergunta e obrigatoria.";
  if(payload.options.length < 2) return "Adicione pelo menos 2 alternativas validas.";
  if(payload.correct_keys.length === 0) return "Marque ao menos uma alternativa correta.";
  const keySet = new Set(payload.options.map((opt) => opt.key));
  if(keySet.size !== payload.options.length) return "As chaves das alternativas precisam ser unicas.";
  return null;
}

async function saveQuestion(){
  setNotice("qNotice", "");
  try{
    const payload = buildQuestionPayload();
    const error = validateQuestionPayload(payload);
    if(error){
      setNotice("qNotice", error);
      return;
    }
    await apiPost("/api/admin/questions", payload, true);
    selectedQuestionId = payload.id;
    setNotice("qNotice", "Questao salva.");
    await loadOverview();
    await loadQuestionList();
    renderQuestionList();
  }catch(e){
    setNotice("qNotice", `Erro: ${e.message}`);
  }
}

async function loadExamFromSelect(){
  const id = el("examSelectAdmin").value;
  if(!id || id === EXAM_SELECT_EMPTY){
    clearExam();
    return;
  }
  const exam = examItems.find((item) => item.id === id);
  if(!exam) return;
  el("examId").value = exam.id;
  el("examTitle").value = exam.title || "";
  el("examSource").value = exam.source || "";
  el("examCount").value = exam.question_count ?? "";
  if(!el("qExamId").value || el("qExamId").value === EXAM_SELECT_EMPTY){
    el("qExamId").value = exam.id;
  }
}

async function loadQuestion(questionId=""){
  setNotice("qNotice", "");
  const targetId = (questionId || el("qLookupId").value || "").trim();
  if(!targetId){
    setNotice("qNotice", "Informe um ID de questao.");
    return;
  }
  try{
    const question = await apiGet(`/api/admin/questions/${targetId}`, true);
    populateQuestionForm(question);
    setNotice("qNotice", "Questao carregada.");
  }catch(e){
    setNotice("qNotice", `Erro: ${e.message}`);
  }
}

async function deleteQuestion(){
  const questionId = el("qId").value.trim();
  if(!questionId){
    setNotice("qNotice", "Nenhuma questao selecionada para excluir.");
    return;
  }
  if(!window.confirm(`Excluir a questao ${questionId}?`)) return;
  try{
    await apiDelete(`/api/admin/questions/${questionId}`, true);
    setNotice("qNotice", "Questao excluida.");
    await loadOverview();
    await loadQuestionList();
    clearQuestion();
  }catch(e){
    setNotice("qNotice", `Erro: ${e.message}`);
  }
}

function duplicateQuestion(){
  el("qLookupId").value = "";
  el("qId").value = "";
  selectedQuestionId = null;
  renderQuestionList();
  renderQuestionInsights();
  setNotice("qNotice", "Conteudo duplicado. Defina um novo ID antes de salvar.");
}

function wireLivePreview(){
  [
    "qLookupId", "qId", "qExamId", "qPrompt", "qJust", "qTags",
    "qDomain", "qDifficulty", "qCertification", "qMulti"
  ].forEach((id) => {
    const node = el(id);
    if(!node) return;
    node.addEventListener("input", renderQuestionInsights);
    node.addEventListener("change", renderQuestionInsights);
  });
}

function handleQuestionListClick(ev){
  const row = ev.target.closest(".question-item");
  if(!row) return;
  loadQuestion(row.dataset.id);
}

function debounceQuestionSearch(){
  if(searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadQuestionList();
  }, 220);
}

async function bootstrap(){
  el("adminKey").value = localStorage.getItem("adminKey") || "";
  wireLivePreview();
  await loadExams();
  await loadOverview();
  clearQuestion({ preserveExam: false });
  await loadQuestionList();
}

el("btn-ingest").addEventListener("click", ingest);
el("btn-export").addEventListener("click", exportDb);
el("btn-refresh-list").addEventListener("click", loadQuestionList);
el("btn-new-q-sidebar").addEventListener("click", () => clearQuestion());
el("btn-load-exam").addEventListener("click", loadExamFromSelect);
el("btn-clear-exam").addEventListener("click", clearExam);
el("btn-save-exam").addEventListener("click", saveExam);
el("btn-load-q").addEventListener("click", () => loadQuestion());
el("btn-clear-q").addEventListener("click", () => clearQuestion());
el("btn-duplicate-q").addEventListener("click", duplicateQuestion);
el("btn-delete-q").addEventListener("click", deleteQuestion);
el("btn-save-q").addEventListener("click", saveQuestion);
el("btn-add-opt").addEventListener("click", () => addOptRow());
el("btn-add-citation").addEventListener("click", () => addCitationRow());
el("examSelectAdmin").addEventListener("change", loadExamFromSelect);
el("browserExam").addEventListener("change", async () => {
  const browserExam = el("browserExam").value;
  if(browserExam && (!el("qExamId").value || el("qExamId").value === EXAM_SELECT_EMPTY)){
    el("qExamId").value = browserExam;
    renderQuestionInsights();
  }
  await loadQuestionList();
});
el("questionSearch").addEventListener("input", debounceQuestionSearch);
el("questionList").addEventListener("click", handleQuestionListClick);
el("adminKey").addEventListener("input", async () => {
  localStorage.setItem("adminKey", el("adminKey").value || "");
  await loadOverview();
  await loadQuestionList();
});
el("qLookupId").addEventListener("keydown", (ev) => {
  if(ev.key === "Enter"){
    ev.preventDefault();
    loadQuestion();
  }
});

bootstrap().catch((err) => {
  setNotice("ingestResult", `Erro ao iniciar painel: ${err.message}`);
});
