function resolveApiOrigin(){
  if(window.API_ORIGIN) return window.API_ORIGIN;
  if(window.location.protocol === "file:" || window.location.port === "5500"){
    return "http://127.0.0.1:8000";
  }
  return window.location.origin;
}

const API_BASE = `${resolveApiOrigin()}/api`;
const STORAGE_KEY = "securityplus_session_id";
const FAVORITES_KEY = "securityplus_favorites";

const el = (id) => document.getElementById(id);

let sessionId = null;
let lastCompletedSessionId = null;
let currentQuestion = null;
let examMap = new Map();
let historyItems = [];
let activeReview = null;
let focusReturnEl = null;
let aiEnabled = false;
let aiModel = null;
let aiBusy = false;

function setModalState(isOpen){
  document.body.classList.toggle("modal-open", isOpen);
  const appRoot = document.querySelector(".app");
  if(!appRoot) return;
  if(isOpen){
    appRoot.setAttribute("aria-hidden", "true");
  }else{
    appRoot.removeAttribute("aria-hidden");
  }
}

async function apiGet(path){
  const res = await fetch(`${API_BASE}${path}`);
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path, body){
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

function show(screenId){
  ["screen-start","screen-quiz","screen-result"].forEach(id => el(id).classList.add("hidden"));
  el(screenId).classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setStatus(txt){ el("apiStatus").textContent = txt; }

function parseIso(iso){
  if(!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(iso){
  const d = parseIso(iso);
  if(!d) return "-";
  return d.toLocaleDateString("pt-BR");
}

function formatDateTime(iso){
  const d = parseIso(iso);
  if(!d) return "-";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatDuration(seconds){
  if(seconds === null || seconds === undefined) return "-";
  const total = Math.round(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if(hrs > 0) return `${hrs}h ${mins}m`;
  if(mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatScore(score){
  if(score === null || score === undefined) return "-";
  return `${Number(score).toFixed(2)}%`;
}

function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRichText(value){
  const escaped = escapeHtml(value || "");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function setRichText(target, value){
  if(!target) return;
  target.innerHTML = formatRichText(value || "");
}

function getFavorites(){
  try{
    const raw = localStorage.getItem(FAVORITES_KEY);
    if(!raw) return new Set();
    const parsed = JSON.parse(raw);
    if(Array.isArray(parsed)) return new Set(parsed);
    return new Set();
  }catch(e){
    return new Set();
  }
}

function setFavorites(set){
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(set)));
}

function isFavorite(sessionIdValue){
  return getFavorites().has(sessionIdValue);
}

function toggleFavorite(sessionIdValue){
  const favs = getFavorites();
  if(favs.has(sessionIdValue)){
    favs.delete(sessionIdValue);
  }else{
    favs.add(sessionIdValue);
  }
  setFavorites(favs);
  return favs.has(sessionIdValue);
}

function showToast(message){
  const wrap = el("toastContainer");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  wrap.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function setAiAvailability(enabled, model){
  const card = el("aiCard");
  if(!card) return;
  aiEnabled = !!enabled;
  aiModel = model || null;
  const badge = el("aiBadge");
  const status = el("aiStatus");
  if(aiEnabled){
    badge.textContent = aiModel ? `AI online (${aiModel})` : "AI online";
    status.textContent = "Explique conceitos sem revelar a alternativa correta.";
  }else{
    badge.textContent = "AI offline";
    status.textContent = "AI indisponivel. Configure GEMINI_API_KEY no backend.";
  }
  card.classList.toggle("ai-disabled", !aiEnabled);
  setAiBusy(false);
}

function setAiBusy(isBusy){
  aiBusy = !!isBusy;
  const card = el("aiCard");
  if(card) card.classList.toggle("ai-busy", aiBusy);
  const input = el("aiInput");
  const send = el("aiSend");
  if(input) input.disabled = aiBusy || !aiEnabled;
  if(send) send.disabled = aiBusy || !aiEnabled;
  if(card){
    const quickBtns = card.querySelectorAll("button[data-ai-mode]");
    quickBtns.forEach(btn => {
      btn.disabled = aiBusy || !aiEnabled;
    });
  }
}

function appendAiMessage(role, text){
  const wrap = el("aiMessages");
  if(!wrap) return;
  const msg = document.createElement("div");
  msg.className = `ai-message ${role}`;
  msg.textContent = text;
  wrap.appendChild(msg);
  wrap.scrollTop = wrap.scrollHeight;
}

function resetAiPanel(){
  const wrap = el("aiMessages");
  if(wrap) wrap.innerHTML = "";
  const input = el("aiInput");
  if(input) input.value = "";
}

function setProgress(currentIndex, total){
  const bar = el("progressFill");
  if(!bar) return;
  const pct = total ? Math.min(100, Math.max(0, (currentIndex / total) * 100)) : 0;
  bar.style.width = `${pct}%`;
}

async function loadExams(){
  try{
    const health = await apiGet("/health");
    setStatus(health.ok ? "online" : "offline");
    setAiAvailability(!!health.ai_enabled, health.ai_model);
  }catch(e){
    setStatus("offline");
    el("startNotice").textContent = "Backend offline. Suba o FastAPI em http://127.0.0.1:8000";
    setAiAvailability(false, null);
    return;
  }

  const exams = await apiGet("/exams");
  examMap = new Map(exams.map(ex => [ex.id, ex]));
  const sel = el("examSelect");
  sel.innerHTML = "<option value=\"\">Misturar todas (random)</option>";
  exams.forEach(ex => {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.title;
    sel.appendChild(opt);
  });

  const histExam = el("historyExam");
  histExam.innerHTML = "<option value=\"\">Todas</option>";
  exams.forEach(ex => {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.title;
    histExam.appendChild(opt);
  });

  await checkResume();
  await loadHistory();
}

function renderQuestion(payload){
  currentQuestion = payload.question;
  const idx = payload.progress_index + 1;
  const total = payload.total_questions;

  el("pill-progress").textContent = `Questao ${idx}/${total}`;
  el("qtitle").textContent = `Questao ${idx}`;
  el("qsub").textContent = currentQuestion.multi_select ? "Selecione TODAS as alternativas corretas." : "Selecione a alternativa correta.";
  el("qtext").textContent = currentQuestion.prompt;
  setProgress(idx, total);

  const form = el("optionsForm");
  form.innerHTML = "";

  const inputType = currentQuestion.multi_select ? "checkbox" : "radio";
  currentQuestion.options.forEach(o => {
    const wrap = document.createElement("label");
    wrap.className = "option";
    wrap.dataset.key = o.key;
    wrap.innerHTML = `
      <input type="${inputType}" name="opt" value="${o.key}" />
      <div>
        <div class="option-key">${o.key}</div>
        <div class="option-text">${o.text}</div>
      </div>
    `;
    form.appendChild(wrap);
  });

  el("feedbackBox").classList.add("hidden");
  el("fbInsight").classList.add("hidden");
  el("fbInsight").textContent = "";
  el("btn-next").disabled = true;
  el("btn-submit").disabled = false;
  el("quizNotice").textContent = "";

  const firstInput = form.querySelector("input");
  if(firstInput) firstInput.focus();
  resetAiPanel();
}

function selectedKeys(){
  const nodes = el("optionsForm").querySelectorAll("input[name='opt']:checked");
  return Array.from(nodes).map(n => n.value);
}

async function fetchNext(){
  const payload = await apiGet(`/sessions/${sessionId}/next`);
  if(payload.finished){
    await showResult();
    return;
  }
  renderQuestion(payload);
}

function setScorePills(correct, wrong){
  el("pill-score").textContent = `Acertos: ${correct} | Erros: ${wrong}`;
}

function syncOptionSelection(){
  el("optionsForm").querySelectorAll(".option").forEach(opt => {
    const input = opt.querySelector("input");
    const checked = input && input.checked;
    opt.classList.toggle("is-selected", !!checked);
  });
}

function markOptions(selected, correct){
  const selectedSet = new Set(selected);
  const correctSet = new Set(correct);
  el("optionsForm").querySelectorAll(".option").forEach(opt => {
    const key = opt.dataset.key;
    opt.classList.remove("is-selected", "is-correct", "is-wrong");
    if(selectedSet.has(key)) opt.classList.add("is-selected");
    if(correctSet.has(key)){
      opt.classList.add("is-correct");
    }else if(selectedSet.has(key)){
      opt.classList.add("is-wrong");
    }
    const input = opt.querySelector("input");
    if(input) input.disabled = true;
  });
}

function showFeedback(fb, selected){
  const box = el("feedbackBox");
  box.classList.remove("hidden", "feedback-success", "feedback-error");
  box.classList.add(fb.is_correct ? "feedback-success" : "feedback-error");

  el("fbHeader").textContent = fb.is_correct ? "Correto" : "Incorreto";
  el("fbCorrect").textContent = fb.correct_keys.join(", ") || "-";
  setRichText(el("fbJustification"), fb.justification || "(Sem justificativa cadastrada.)");

  const live = fb.insight || {};
  const liveWrap = el("fbInsight");
  const liveBits = [];
  if(live.message) liveBits.push(live.message);
  if(live.remaining_questions !== undefined) liveBits.push(`Restantes: ${live.remaining_questions}`);
  if(live.current_correct_streak !== undefined) liveBits.push(`Streak atual: ${live.current_correct_streak}`);
  if(liveBits.length){
    liveWrap.textContent = liveBits.join(" | ");
    liveWrap.classList.remove("hidden");
  }else{
    liveWrap.textContent = "";
    liveWrap.classList.add("hidden");
  }

  setScorePills(fb.correct_count, fb.wrong_count);
  markOptions(selected, fb.correct_keys);

  el("btn-next").disabled = false;
  el("btn-submit").disabled = true;

  if(fb.finished){
    el("btn-next").textContent = "Ver resultado";
  }else{
    el("btn-next").textContent = "Proxima";
  }
}

function buildQuickMessage(mode){
  if(mode === "why_wrong") return "Por que minha resposta esta errada? Explique o erro e como evitar.";
  if(mode === "review") return "Revisar materia relacionada a esta questao.";
  return "Me ajude a entender esta questao e os conceitos envolvidos.";
}

async function sendAiRequest({ message, mode, displayMessage }){
  if(!aiEnabled){
    showToast("AI indisponivel.");
    return;
  }
  if(!sessionId || !currentQuestion){
    showToast("Nenhuma questao ativa.");
    return;
  }
  const msg = (message || "").trim();
  if(msg && msg.length > 800){
    showToast("Mensagem muito longa.");
    return;
  }
  const reqQuestionId = currentQuestion.id;
  if(displayMessage){
    appendAiMessage("user", displayMessage);
  }else if(msg){
    appendAiMessage("user", msg);
  }
  setAiBusy(true);
  try{
    const res = await apiPost(`/sessions/${sessionId}/questions/${reqQuestionId}/tutor`, {
      user_message: msg || null,
      mode: mode || "help"
    });
    if(currentQuestion?.id !== reqQuestionId){
      showToast("Resposta da IA chegou apos trocar de questao.");
      return;
    }
    const role = res.blocked ? "system" : "assistant";
    appendAiMessage(role, res.message || "Sem resposta.");
  }catch(e){
    appendAiMessage("system", `Erro ao consultar IA: ${e.message}`);
  }finally{
    setAiBusy(false);
  }
}

async function askAi(ev){
  if(ev) ev.preventDefault();
  const input = el("aiInput");
  const message = (input?.value || "").trim();
  if(message.length < 3){
    showToast("Digite uma duvida mais especifica.");
    return;
  }
  if(input) input.value = "";
  await sendAiRequest({ message, mode: "help" });
}

function renderInsightCards(targetId, items){
  const wrap = el(targetId);
  wrap.innerHTML = "";
  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "insight-card";
    card.innerHTML = `
      <div class="label">${item.label}</div>
      <div class="value">${item.value}</div>
    `;
    wrap.appendChild(card);
  });
}

function renderChips(targetId, items){
  const wrap = el(targetId);
  wrap.innerHTML = "";
  items.forEach(text => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = text;
    wrap.appendChild(chip);
  });
}

function renderWeakAreas(targetId, items, emptyMessage){
  const wrap = el(targetId);
  wrap.innerHTML = "";
  if(!Array.isArray(items) || items.length === 0){
    wrap.className = "stack-list empty";
    wrap.textContent = emptyMessage;
    return;
  }

  wrap.className = "stack-list";
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "stack-item";
    row.innerHTML = `
      <div>
        <div class="title">${escapeHtml(item.label || "Sem rotulo")}</div>
        <div class="meta">${item.wrong ?? 0} erro(s) em ${item.total ?? 0} questoes</div>
      </div>
      <div class="score">${formatScore(item.score_percent ?? 0)}</div>
    `;
    wrap.appendChild(row);
  });
}

function renderDomainBreakdown(targetId, items, emptyMessage){
  const wrap = el(targetId);
  const entries = Object.entries(items || {});
  if(entries.length === 0){
    wrap.className = "empty";
    wrap.textContent = emptyMessage;
    return;
  }

  wrap.className = "stack-list";
  wrap.innerHTML = "";
  entries.slice(0, 8).forEach(([label, value]) => {
    const item = (value && typeof value === "object") ? value : { score_percent: value };
    const row = document.createElement("div");
    row.className = "stack-item";
    row.innerHTML = `
      <div>
        <div class="title">${escapeHtml(label)}</div>
        <div class="meta">${item.wrong ?? 0} erro(s) em ${item.total ?? 0} questoes</div>
      </div>
      <div class="score">${formatScore(item.score_percent ?? 0)}</div>
    `;
    wrap.appendChild(row);
  });
}

function renderStudyPlan(targetId, items, emptyMessage){
  const wrap = el(targetId);
  wrap.innerHTML = "";
  if(!Array.isArray(items) || items.length === 0){
    wrap.className = "stack-list empty";
    wrap.textContent = emptyMessage;
    return;
  }

  wrap.className = "study-list";
  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "study-item";
    const topics = Array.isArray(item.topics) ? item.topics : [];
    const resources = Array.isArray(item.resources) ? item.resources : [];
    card.innerHTML = `
      <div class="study-head">
        <div>
          <div class="study-title">${escapeHtml(item.domain || "Sem dominio")}</div>
          <div class="study-meta">${item.wrong ?? 0} erro(s) em ${item.total ?? 0} questoes · ${formatScore(item.score_percent ?? 0)}</div>
        </div>
      </div>
      <div class="study-text">${escapeHtml(item.reason || "")}</div>
      <div class="study-text">${escapeHtml(item.action || "")}</div>
      <div class="chip-grid">${topics.length ? topics.map(topic => `<div class="chip">${escapeHtml(topic)}</div>`).join("") : '<div class="chip">Revisao geral</div>'}</div>
      <div class="study-sources">
        ${resources.length ? resources.map(source => `<div class="study-source">${escapeHtml(source)}</div>`).join("") : '<div class="study-source">Use as justificativas das questoes erradas como revisao imediata.</div>'}
      </div>
    `;
    wrap.appendChild(card);
  });
}

function renderMissed(items){
  const wrap = el("insightMissed");
  wrap.innerHTML = "";
  if(!items || items.length === 0){
    const empty = document.createElement("div");
    empty.className = "missed-item";
    empty.innerHTML = `<div class=\"body\">Nenhum erro registrado. Excelente!</div>`;
    wrap.appendChild(empty);
    return;
  }
  items.forEach(item => {
    const elItem = document.createElement("div");
    elItem.className = "missed-item";
    const meta = [item.domain, item.difficulty].filter(Boolean).join(" · ");
    elItem.innerHTML = `
      <div class="title">${escapeHtml(item.id)}${meta ? ` · ${escapeHtml(meta)}` : ""}</div>
      <div class="body">${escapeHtml(item.prompt)}</div>
    `;
    wrap.appendChild(elItem);
  });
}

async function showResult(){
  const res = await apiGet(`/sessions/${sessionId}/result`);
  lastCompletedSessionId = res.session_id;

  el("resScore").textContent = `${res.score_percent.toFixed(2)}%`;
  el("resCorrect").textContent = String(res.correct_count);
  el("resWrong").textContent = String(res.wrong_count);
  el("resStatus").textContent = res.passed ? "APROVADO (>= 90%)" : "REPROVADO (< 90%)";

  const summary = res.insight?.summary || {};
  const weakest = Array.isArray(res.insight?.weakest_domains) ? res.insight.weakest_domains[0] : null;
  el("resultSubtitle").textContent = weakest
    ? `Area com mais erros: ${weakest.label} (${weakest.wrong} erro(s)).`
    : "Veja seu desempenho geral e os principais insights.";
  el("resDuration").textContent = formatDuration(summary.duration_seconds);

  renderInsightCards("insightSummary", [
    { label: "Respondidas", value: summary.attempted ?? 0 },
    { label: "Nao respondidas", value: summary.unanswered ?? 0 },
    { label: "Precisao", value: `${summary.accuracy_percent ?? 0}%` },
    { label: "Maior streak", value: summary.max_correct_streak ?? 0 },
    { label: "Streak de erros", value: summary.max_wrong_streak ?? 0 },
    { label: "Tempo total", value: formatDuration(summary.duration_seconds) },
    { label: "Media por questao", value: summary.avg_seconds_per_question ? `${summary.avg_seconds_per_question}s` : "-" },
    { label: "Ultimas 5", value: summary.recent_five_accuracy !== null && summary.recent_five_accuracy !== undefined ? `${summary.recent_five_accuracy}%` : "-" }
  ]);

  const byType = res.insight?.by_type || {};
  renderInsightCards("insightByType", [
    { label: "Single-select", value: `${byType.single_select?.score_percent ?? 0}% (${byType.single_select?.correct ?? 0}/${byType.single_select?.total ?? 0})` },
    { label: "Multi-select", value: `${byType.multi_select?.score_percent ?? 0}% (${byType.multi_select?.correct ?? 0}/${byType.multi_select?.total ?? 0})` }
  ]);

  const focusItems = [...(res.insight?.focus || [])];
  if(res.insight?.recommendation) focusItems.push(res.insight.recommendation);
  const patternItems = [...(res.insight?.patterns || [])];
  renderChips("insightFocus", focusItems.length ? focusItems : ["Sem recomendacoes."]);
  renderMissed(res.insight?.missed_sample || []);
  renderWeakAreas("insightDomains", res.insight?.weakest_domains || [], "Sem dados de dominio suficientes.");
  renderChips("insightPatterns", patternItems.length ? patternItems : ["Sem padroes relevantes ainda."]);
  renderStudyPlan("insightStudyPlan", res.insight?.study_plan || [], "Sem recomendacoes de estudo ainda.");

  localStorage.removeItem(STORAGE_KEY);
  show("screen-result");
  await loadHistory();
}

async function beginSession(payload){
  el("startNotice").textContent = "";
  el("quizNotice").textContent = "";
  try{
    const s = await apiPost("/sessions", payload);
    sessionId = s.id;
    localStorage.setItem(STORAGE_KEY, sessionId);
    setScorePills(s.correct_count, s.wrong_count);
    show("screen-quiz");
    await fetchNext();
    return true;
  }catch(e){
    el("startNotice").textContent = `Erro: ${e.message}`;
    return false;
  }
}

async function start(){
  const examId = el("examSelect").value || null;
  const totalQuestions = parseInt(el("totalQuestions").value || "90", 10);
  await beginSession({ exam_id: examId, total_questions: totalQuestions });
}

async function checkResume(){
  const stored = localStorage.getItem(STORAGE_KEY);
  if(!stored) return;
  try{
    const state = await apiGet(`/sessions/${stored}`);
    if(state.finished){
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const examTitle = state.exam_id ? (examMap.get(state.exam_id)?.title || state.exam_id) : "Misturar todas";
    el("continueMeta").textContent = `Prova: ${examTitle} · Questao ${state.current_index + 1}/${state.total_questions} · Acertos ${state.correct_count}`;
    el("continueBox").classList.remove("hidden");
    el("btn-continue").onclick = async () => {
      sessionId = stored;
      setScorePills(state.correct_count, state.wrong_count);
      show("screen-quiz");
      await fetchNext();
    };
    el("btn-discard").onclick = () => {
      localStorage.removeItem(STORAGE_KEY);
      el("continueBox").classList.add("hidden");
    };
  }catch(e){
    localStorage.removeItem(STORAGE_KEY);
  }
}

function renderHeroStats(){
  const total = historyItems.length;
  el("statSessions").textContent = String(total);
  if(total === 0){
    el("statLastScore").textContent = "-";
    el("statBestScore").textContent = "-";
    el("statAvgScore").textContent = "-";
    el("statLastDate").textContent = "-";
    el("statBestDate").textContent = "-";
    return;
  }
  const sorted = [...historyItems].sort((a, b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at));
  const last = sorted[0];
  const best = sorted.reduce((acc, item) => item.score_percent > acc.score_percent ? item : acc, sorted[0]);
  const avg = sorted.reduce((sum, item) => sum + (item.score_percent || 0), 0) / total;

  el("statLastScore").textContent = formatScore(last.score_percent);
  el("statLastDate").textContent = formatDate(last.completed_at || last.created_at);
  el("statBestScore").textContent = formatScore(best.score_percent);
  el("statBestDate").textContent = formatDate(best.completed_at || best.created_at);
  el("statAvgScore").textContent = formatScore(avg);
}

function getHistoryFilters(){
  const query = (el("historySearch").value || "").toLowerCase();
  const exam = el("historyExam").value || "";
  const minScore = el("historyMinScore").value ? parseFloat(el("historyMinScore").value) : null;
  const from = el("historyFrom").value ? new Date(`${el("historyFrom").value}T00:00:00`) : null;
  const to = el("historyTo").value ? new Date(`${el("historyTo").value}T23:59:59`) : null;
  return { query, exam, minScore, from, to };
}

function renderHistory(){
  const list = el("historyList");
  const empty = el("historyEmpty");
  const filters = getHistoryFilters();
  const filtered = historyItems.filter(item => {
    const title = (item.exam_title || item.exam_id || "Misturar todas").toLowerCase();
    const id = (item.id || "").toLowerCase();
    if(filters.query && !title.includes(filters.query) && !id.includes(filters.query)) return false;
    if(filters.exam && item.exam_id !== filters.exam) return false;
    if(filters.minScore !== null && (item.score_percent ?? 0) < filters.minScore) return false;
    const date = parseIso(item.completed_at || item.created_at);
    if(filters.from && date && date < filters.from) return false;
    if(filters.to && date && date > filters.to) return false;
    return true;
  });

  el("historyCount").textContent = `${filtered.length} resultado(s) no historico`;
  list.innerHTML = "";

  if(filtered.length === 0){
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  filtered.forEach(item => {
    const row = document.createElement("div");
    row.className = "history-item";
    const examTitle = item.exam_title || (item.exam_id ? item.exam_id : "Misturar todas");
    const favActive = isFavorite(item.id);
    row.innerHTML = `
      <div>
        <div class="history-title">${examTitle}</div>
        <div class="history-meta">${formatDate(item.completed_at || item.created_at)} · ${item.total_questions} questoes · ${formatScore(item.score_percent)} · ${item.correct_count} acertos</div>
      </div>
      <div class="history-actions">
        <button class="btn btn-ghost" data-action="review" data-id="${item.id}" type="button" aria-haspopup="dialog">Revisar</button>
        <button class="btn btn-ghost" data-action="favorite" data-id="${item.id}" type="button" aria-pressed="${favActive}">${favActive ? "Favorito" : "Salvar"}</button>
      </div>
    `;
    list.appendChild(row);
  });
}

async function loadHistory(){
  try{
    historyItems = await apiGet("/sessions/history?limit=200");
  }catch(e){
    historyItems = [];
    el("historyCount").textContent = "Nao foi possivel carregar o historico.";
    return;
  }
  renderHeroStats();
  renderHistory();
}

function renderTrend(sessionIdValue){
  const wrap = el("reviewTrend");
  wrap.innerHTML = "";
  if(historyItems.length === 0){
    wrap.innerHTML = "<div class=\"muted\">Sem dados suficientes para tendencia.</div>";
    return;
  }
  const sorted = [...historyItems].sort((a, b) => new Date(a.completed_at || a.created_at) - new Date(b.completed_at || b.created_at));
  const recent = sorted.slice(-10);
  recent.forEach(item => {
    const bar = document.createElement("div");
    bar.className = "trend-bar" + (item.id === sessionIdValue ? " active" : "");
    const height = Math.max(10, (item.score_percent || 0) / 100 * 110);
    bar.style.height = `${height}px`;
    bar.title = `${formatScore(item.score_percent)} - ${formatDate(item.completed_at || item.created_at)}`;
    wrap.appendChild(bar);
  });
}

function renderReviewQuestions(questions){
  const wrap = el("reviewQuestions");
  wrap.innerHTML = "";
  questions.forEach((q, idx) => {
    const item = document.createElement("div");
    item.className = "review-item";
    let badgeClass = "badge badge-danger";
    let badgeText = "Errada";
    if(q.is_correct === true){
      badgeClass = "badge badge-success";
      badgeText = "Correta";
    }else if(q.is_correct === null || q.is_correct === undefined){
      badgeClass = "badge badge-outline";
      badgeText = "Nao respondida";
    }
    const optionsHtml = q.options.map(opt => {
      const selected = q.selected_keys.includes(opt.key);
      const correct = q.correct_keys.includes(opt.key);
      const classes = ["review-option", selected ? "is-selected" : "", correct ? "is-correct" : "", (!correct && selected) ? "is-wrong" : ""].filter(Boolean).join(" ");
      return `<div class="${classes}">${escapeHtml(opt.key)}. ${escapeHtml(opt.text)}</div>`;
    }).join("");
    const metaTags = [q.certification, q.domain, q.difficulty, ...(Array.isArray(q.tags) ? q.tags : [])].filter(Boolean);
    const tags = metaTags.length
      ? `<div class="chip-grid" style="margin-top:10px;">${metaTags.map(tag => `<div class="chip">${escapeHtml(tag)}</div>`).join("")}</div>`
      : "";

    item.innerHTML = `
      <div class="review-header">
        <div>
          <div class="review-title">Questao ${idx + 1}</div>
          <div class="muted">${escapeHtml(q.prompt)}</div>
        </div>
        <span class="${badgeClass}">${badgeText}</span>
      </div>
      <div class="review-options">${optionsHtml}</div>
      <div class="muted" style="margin-top:10px;">Sua resposta: ${escapeHtml(q.selected_keys.join(", ") || "-")} · Correta: ${escapeHtml(q.correct_keys.join(", ") || "-")}</div>
      ${tags}
      <div class="justification">${formatRichText(q.justification || "(Sem justificativa cadastrada.)")}</div>
    `;
    wrap.appendChild(item);
  });
}

function renderReviewModal(data){
  const examTitle = data.session.exam_title || (data.session.exam_id ? data.session.exam_id : "Misturar todas");
  el("reviewTitle").textContent = `Revisao - ${examTitle}`;
  el("reviewMeta").textContent = `${formatDateTime(data.session.completed_at || data.session.created_at)} · Score ${formatScore(data.session.score_percent)} · ${data.session.total_questions} questoes`;

  const summary = data.result.insight?.summary || {};
  renderInsightCards("reviewSummary", [
    { label: "Score", value: `${data.result.score_percent}%` },
    { label: "Acertos", value: data.result.correct_count },
    { label: "Erros", value: data.result.wrong_count },
    { label: "Tempo total", value: formatDuration(summary.duration_seconds) },
    { label: "Precisao", value: `${summary.accuracy_percent ?? 0}%` },
    { label: "Media por questao", value: summary.avg_seconds_per_question ? `${summary.avg_seconds_per_question}s` : "-" }
  ]);

  const byType = data.result.insight?.by_type || {};
  renderInsightCards("reviewByType", [
    { label: "Single-select", value: `${byType.single_select?.score_percent ?? 0}% (${byType.single_select?.correct ?? 0}/${byType.single_select?.total ?? 0})` },
    { label: "Multi-select", value: `${byType.multi_select?.score_percent ?? 0}% (${byType.multi_select?.correct ?? 0}/${byType.multi_select?.total ?? 0})` }
  ]);

  renderDomainBreakdown("reviewByDomain", data.result.insight?.by_domain || data.result.insight?.by_topic || {}, "Sem dados de dominio/tema.");

  renderTrend(data.session.id);
  renderReviewQuestions(data.questions || []);

  const favoriteBtn = el("btn-review-favorite");
  const favActive = isFavorite(data.session.id);
  favoriteBtn.textContent = favActive ? "Remover favorito" : "Salvar como favorito";
  favoriteBtn.setAttribute("aria-pressed", favActive);
}

function trapFocus(modal){
  if(modal.dataset.trap === "true") return;
  modal.dataset.trap = "true";
  modal.addEventListener("keydown", (ev) => {
    if(ev.key !== "Tab") return;
    const focusable = modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if(!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if(ev.shiftKey && document.activeElement === first){
      ev.preventDefault();
      last.focus();
    }else if(!ev.shiftKey && document.activeElement === last){
      ev.preventDefault();
      first.focus();
    }
  });
}

function openReviewModal(sessionIdValue){
  focusReturnEl = document.activeElement;
  apiGet(`/sessions/${sessionIdValue}/review`).then(data => {
    activeReview = data;
    renderReviewModal(data);
    const modal = el("reviewModal");
    modal.classList.remove("hidden");
    setModalState(true);
    trapFocus(modal);
    el("btn-review-close").focus();
  }).catch(err => {
    showToast(`Erro ao carregar revisao: ${err.message}`);
  });
}

function closeReviewModal(){
  const modal = el("reviewModal");
  modal.classList.add("hidden");
  setModalState(false);
  activeReview = null;
  if(focusReturnEl && typeof focusReturnEl.focus === "function"){
    focusReturnEl.focus();
  }
}

async function retryWrong(sessionIdValue){
  let review = activeReview;
  if(sessionIdValue && (!review || review.session?.id !== sessionIdValue)){
    try{
      review = await apiGet(`/sessions/${sessionIdValue}/review`);
      activeReview = review;
    }catch(err){
      showToast(`Erro ao carregar revisao: ${err.message}`);
      return;
    }
  }
  if(!review){
    showToast("Revisao indisponivel.");
    return;
  }
  if(!review.session || !Array.isArray(review.questions)){
    showToast("Revisao incompleta.");
    return;
  }
  const wrongIds = review.questions.filter(q => q.is_correct === false).map(q => q.id);
  if(wrongIds.length === 0){
    showToast("Nenhuma questao errada para refazer.");
    return;
  }
  closeReviewModal();
  const ok = await beginSession({
    exam_id: review.session.exam_id,
    total_questions: wrongIds.length,
    question_ids: wrongIds
  });
  if(!ok){
    showToast("Nao foi possivel iniciar o simulado de erradas.");
  }
}

async function retryFull(){
  const review = activeReview;
  if(!review || !review.session){
    showToast("Revisao indisponivel.");
    return;
  }
  closeReviewModal();
  const ok = await beginSession({
    exam_id: review.session.exam_id,
    total_questions: review.session.total_questions
  });
  if(!ok){
    showToast("Nao foi possivel iniciar o simulado completo.");
  }
}

function exportReview(){
  const review = activeReview;
  if(!review || !review.session?.id){
    showToast("Revisao indisponivel.");
    return;
  }
  const blob = new Blob([JSON.stringify(review, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `securityplus_review_${review.session.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

el("btn-start").addEventListener("click", start);

el("optionsForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if(!currentQuestion) return;

  const keys = selectedKeys();
  if(keys.length === 0){
    el("quizNotice").textContent = "Selecione pelo menos uma alternativa.";
    return;
  }
  el("quizNotice").textContent = "";

  try{
    const fb = await apiPost(`/sessions/${sessionId}/answer`, {
      question_id: currentQuestion.id,
      selected_keys: keys
    });
    showFeedback(fb, keys);
  }catch(e){
    el("quizNotice").textContent = `Erro: ${e.message}`;
  }
});

el("optionsForm").addEventListener("change", (ev) => {
  if(ev.target && ev.target.matches("input[name='opt']")){
    syncOptionSelection();
  }
});

el("btn-next").addEventListener("click", async () => {
  if(el("btn-next").textContent.toLowerCase().includes("resultado")){
    await showResult();
    return;
  }
  await fetchNext();
});

el("btn-restart").addEventListener("click", () => {
  sessionId = null;
  currentQuestion = null;
  show("screen-start");
});

el("btn-review").addEventListener("click", () => {
  if(!lastCompletedSessionId){
    showToast("Nenhuma revisao disponivel.");
    return;
  }
  openReviewModal(lastCompletedSessionId);
});

el("btn-retry-wrong").addEventListener("click", async () => {
  if(!lastCompletedSessionId){
    showToast("Nenhuma revisao disponivel.");
    return;
  }
  await retryWrong(lastCompletedSessionId);
});

el("btn-reset").addEventListener("click", () => {
  sessionId = null;
  currentQuestion = null;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

el("btn-history-refresh").addEventListener("click", loadHistory);

el("historySearch").addEventListener("input", renderHistory);
el("historyExam").addEventListener("change", renderHistory);
el("historyMinScore").addEventListener("change", renderHistory);
el("historyFrom").addEventListener("change", renderHistory);
el("historyTo").addEventListener("change", renderHistory);

el("historyList").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-action]");
  if(!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if(action === "review"){
    openReviewModal(id);
  }
  if(action === "favorite"){
    const active = toggleFavorite(id);
    btn.textContent = active ? "Favorito" : "Salvar";
    btn.setAttribute("aria-pressed", active);
    showToast(active ? "Adicionado aos favoritos." : "Removido dos favoritos.");
  }
});

el("btn-review-close").addEventListener("click", closeReviewModal);

el("reviewModal").addEventListener("click", (ev) => {
  if(ev.target && ev.target.dataset.close === "true"){
    closeReviewModal();
  }
});

el("reviewModal").addEventListener("keydown", (ev) => {
  if(ev.key === "Escape"){
    closeReviewModal();
  }
});

el("btn-review-retry-wrong").addEventListener("click", () => {
  const sessionIdValue = activeReview?.session?.id || lastCompletedSessionId || null;
  return retryWrong(sessionIdValue);
});

el("btn-review-retry-full").addEventListener("click", retryFull);

el("btn-review-favorite").addEventListener("click", () => {
  const review = activeReview;
  if(!review || !review.session?.id){
    showToast("Revisao indisponivel.");
    return;
  }
  const active = toggleFavorite(review.session.id);
  el("btn-review-favorite").textContent = active ? "Remover favorito" : "Salvar como favorito";
  el("btn-review-favorite").setAttribute("aria-pressed", active);
  renderHistory();
});

el("btn-review-export").addEventListener("click", exportReview);

el("aiForm").addEventListener("submit", askAi);
el("aiClear").addEventListener("click", resetAiPanel);
el("aiCard").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-ai-mode]");
  if(!btn) return;
  const mode = btn.dataset.aiMode;
  const label = btn.textContent.trim();
  const message = buildQuickMessage(mode);
  sendAiRequest({ message, mode, displayMessage: label });
});

loadExams().catch(console.error);
