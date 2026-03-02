function resolveApiOrigin(){
  if(window.API_ORIGIN) return window.API_ORIGIN;
  if(window.location.protocol === "file:" || window.location.port === "5500"){
    return "http://127.0.0.1:8000";
  }
  return window.location.origin;
}

const API_BASE = `${resolveApiOrigin()}/api`;
const STORAGE_KEY = "securityplus_session_id";
const STUDY_STORAGE_KEY = "securityplus_study_session_id";
const FAVORITES_KEY = "securityplus_favorites";
const CLIENT_KEY_STORAGE_KEY = "sentinel_client_key";
const AUTH_TOKEN_STORAGE_KEY = "sentinel_auth_token";

const el = (id) => document.getElementById(id);

let sessionId = null;
let lastCompletedSessionId = null;
let currentQuestion = null;
let examMap = new Map();
let historyItems = [];
let studyHistoryItems = [];
let activeReview = null;
let activeStudyReview = null;
let focusReturnEl = null;
let aiEnabled = false;
let aiModel = null;
let aiBusy = false;
let domainCatalogCache = new Map();
let weakAreaSnapshot = null;
let studyWeeklyAnalytics = null;
let currentUser = null;
let studyOverview = null;
let reviewQueueSnapshot = null;
let currentStudyState = null;
let currentStudyQuestionId = null;
let studyStateDirty = false;
let fallbackClientKey = "";
let fallbackAuthToken = "";
let currentSessionMode = "exam";
let currentStudyStrategy = "standard";
let lastCompletedSessionMode = "exam";
let questionStartedAt = null;

function readStorage(key){
  try{
    return localStorage.getItem(key);
  }catch(e){
    return null;
  }
}

function writeStorage(key, value){
  try{
    localStorage.setItem(key, value);
  }catch(e){
    // Best effort only. The UI still works without persistence.
  }
}

function removeStorage(key){
  try{
    localStorage.removeItem(key);
  }catch(e){
    // Ignore storage failures.
  }
}

function createClientKey(){
  if(window.crypto && typeof window.crypto.randomUUID === "function"){
    return `web-${window.crypto.randomUUID()}`;
  }
  const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `web-${fallback}`;
}

function getOrCreateClientKey(){
  const existing = String(readStorage(CLIENT_KEY_STORAGE_KEY) || "").trim();
  if(existing){
    fallbackClientKey = existing;
    return existing;
  }
  if(fallbackClientKey){
    return fallbackClientKey;
  }
  const created = createClientKey();
  fallbackClientKey = created;
  writeStorage(CLIENT_KEY_STORAGE_KEY, created);
  return created;
}

function getStoredAuthToken(){
  const stored = String(readStorage(AUTH_TOKEN_STORAGE_KEY) || "").trim();
  if(stored){
    fallbackAuthToken = stored;
    return stored;
  }
  return fallbackAuthToken;
}

function setStoredAuthToken(token){
  const normalized = String(token || "").trim();
  fallbackAuthToken = normalized;
  if(!normalized){
    removeStorage(AUTH_TOKEN_STORAGE_KEY);
    return "";
  }
  writeStorage(AUTH_TOKEN_STORAGE_KEY, normalized);
  return normalized;
}

function clearStoredAuthToken(){
  fallbackAuthToken = "";
  removeStorage(AUTH_TOKEN_STORAGE_KEY);
}

function buildApiHeaders(extraHeaders = {}){
  const headers = new Headers(extraHeaders);
  const clientKey = getOrCreateClientKey();
  if(clientKey){
    headers.set("X-Client-Key", clientKey);
  }
  const authToken = getStoredAuthToken();
  if(authToken){
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  return headers;
}

async function apiRequest(path, options = {}){
  const url = `${API_BASE}${path}`;
  const send = async () => fetch(url, {
    ...options,
    headers: buildApiHeaders(options.headers || {})
  });

  let res = await send();
  if(res.status === 401 && getStoredAuthToken()){
    clearStoredAuthToken();
    handleAuthTokenCleared();
    res = await send();
  }
  if(!res.ok) throw new Error(await parseErrorResponse(res));
  return res.json();
}

async function parseErrorResponse(res){
  const body = await res.text();
  if(!body){
    return `HTTP ${res.status}`;
  }
  try{
    const parsed = JSON.parse(body);
    if(parsed && typeof parsed.detail === "string" && parsed.detail.trim()){
      return parsed.detail.trim();
    }
  }catch(e){
    // Ignore JSON parse errors and fall back to raw text.
  }
  return body;
}

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
  return apiRequest(path);
}

async function apiPost(path, body){
  return apiRequest(path, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
}

async function apiPut(path, body){
  return apiRequest(path, {
    method: "PUT",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
}

function getSessionStorageKey(mode){
  return mode === "study" ? STUDY_STORAGE_KEY : STORAGE_KEY;
}

function isStudyMode(mode = currentSessionMode){
  return mode === "study";
}

function currentSessionApiBase(mode = currentSessionMode){
  return isStudyMode(mode) ? "/study/sessions" : "/sessions";
}

function getSelectedMode(){
  const value = el("modeSelect")?.value || "exam";
  return value === "study" ? "study" : "exam";
}

function clearStoredSession(mode){
  removeStorage(getSessionStorageKey(mode));
}

function writeStoredSession(mode, id){
  writeStorage(getSessionStorageKey(mode), id);
}

function updateModeUi(mode = getSelectedMode()){
  const isStudy = mode === "study";
  el("btn-start").textContent = isStudy ? "Comecar estudo" : "Comecar";
  el("btn-start-review-queue").classList.toggle("hidden", !isStudy);
  el("studyStrategyField").classList.toggle("hidden", !isStudy);
  el("confidenceSelect").disabled = !isStudy;
  el("studyStrategySelect").disabled = !isStudy;
  el("modeHint").textContent = isStudy
    ? "Study mode registra confianca, gera fila de revisao e permite blocos adaptativos."
    : "Exam mode simula prova, sem feedback de confianca influenciando a fila.";
  el("confidenceHint").textContent = isStudy
    ? "Usado no study mode para agendar a proxima revisao."
    : "No exam mode a confianca nao altera o fluxo da prova.";
  if(!isStudy){
    el("confidenceSelect").value = "medium";
    el("studyStrategySelect").value = "standard";
  }
}

function resetStudyEditorUi(){
  currentStudyQuestionId = null;
  currentStudyState = null;
  studyStateDirty = false;
  el("studyBookmark").checked = false;
  el("studyNote").value = "";
  el("confidenceSelect").value = "medium";
  el("studySyncBadge").textContent = "Aguardando";
  el("studyNotice").textContent = "";
  el("studyScopeCopy").textContent = currentUser
    ? "Este status fica salvo na sua conta e sincroniza com outros dispositivos."
    : "Este status fica salvo somente neste dispositivo ate voce entrar em uma conta.";
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

function formatStudyStrategy(strategy){
  const normalized = String(strategy || "standard").toLowerCase();
  if(normalized === "adaptive") return "Adaptativa";
  if(normalized === "review") return "Revisao diaria";
  if(normalized === "manual") return "Manual";
  return "Padrao";
}

function formatCitationPages(start, end){
  if(start === null || start === undefined){
    return "";
  }
  if(end !== null && end !== undefined && String(start) !== String(end)){
    return `pp. ${start}-${end}`;
  }
  return `p. ${start}`;
}

function formatCitationText(citation){
  if(!citation || typeof citation !== "object"){
    return "";
  }
  const source = String(citation.source || "").trim();
  let reference = String(citation.reference || "").trim();
  const chapter = String(citation.chapter || "").trim();
  const section = String(citation.section || "").trim();
  const locator = String(citation.locator || "").trim();
  if(!reference){
    if(chapter && section && section.toLowerCase() !== chapter.toLowerCase()){
      reference = `${chapter} -> ${section}`;
    }else{
      reference = chapter || section;
    }
  }
  const pageText = formatCitationPages(citation.page_start, citation.page_end);
  const details = [reference, pageText, locator].filter(Boolean);
  if(source && details.length){
    return `${source}: ${details.join(" | ")}`;
  }
  return source || details.join(" | ");
}

function buildMaterialPreviewUrl(citation){
  if(!citation || typeof citation !== "object" || !citation.material_path){
    return "";
  }
  const params = new URLSearchParams();
  params.set("material_path", String(citation.material_path));
  if(citation.locator) params.set("locator", String(citation.locator));
  if(citation.page_start !== null && citation.page_start !== undefined){
    params.set("page_start", String(citation.page_start));
  }
  if(citation.page_end !== null && citation.page_end !== undefined){
    params.set("page_end", String(citation.page_end));
  }
  return `${API_BASE}/materials/preview?${params.toString()}`;
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
    const raw = readStorage(FAVORITES_KEY);
    if(!raw) return new Set();
    const parsed = JSON.parse(raw);
    if(Array.isArray(parsed)) return new Set(parsed);
    return new Set();
  }catch(e){
    return new Set();
  }
}

function setFavorites(set){
  writeStorage(FAVORITES_KEY, JSON.stringify(Array.from(set)));
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

function formatDeviceKeyLabel(){
  const clientKey = getOrCreateClientKey();
  if(!clientKey) return "-";
  if(clientKey.length <= 22) return clientKey;
  return `${clientKey.slice(0, 10)}...${clientKey.slice(-8)}`;
}

function handleAuthTokenCleared(){
  currentUser = null;
  studyOverview = null;
  reviewQueueSnapshot = null;
  studyWeeklyAnalytics = null;
  renderAccountCard();
}

function renderRecentStudyList(targetId, items, emptyMessage){
  const wrap = el(targetId);
  if(!wrap) return;
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
    const excerpt = item.excerpt ? `<div class="meta">${escapeHtml(item.excerpt)}</div>` : "";
    row.innerHTML = `
      <div>
        <div class="title">${escapeHtml(item.prompt || item.question_id || "Questao")}</div>
        ${excerpt}
      </div>
      <div class="meta">${formatDate(item.updated_at)}</div>
    `;
    wrap.appendChild(row);
  });
}

function renderAccountCard(){
  const mode = studyOverview?.scope || (currentUser ? "user" : "device");
  const modeBadge = el("accountModeBadge");
  const subtitle = el("accountSubtitle");
  if(modeBadge){
    modeBadge.textContent = mode === "user" ? "Conta sincronizada" : "Dispositivo local";
  }
  if(subtitle){
    subtitle.textContent = currentUser
      ? "Seu progresso agora esta sincronizado com a conta atual."
      : "Entre para sincronizar progresso entre dispositivos ou continue com o historico local deste navegador.";
  }

  const guest = el("accountGuest");
  const userPane = el("accountUser");
  if(currentUser){
    guest.classList.add("hidden");
    userPane.classList.remove("hidden");
    el("accountName").textContent = currentUser.display_name || currentUser.email || "Usuario";
    el("accountEmail").textContent = currentUser.email || "-";
    el("accountRole").textContent = currentUser.role || "student";
  }else{
    guest.classList.remove("hidden");
    userPane.classList.add("hidden");
  }
  el("accountDeviceMeta").textContent = `Dispositivo atual: ${formatDeviceKeyLabel()}`;

  el("accountBookmarkCount").textContent = String(studyOverview?.bookmark_count ?? 0);
  el("accountNoteCount").textContent = String(studyOverview?.note_count ?? 0);
  el("accountDueReviewCount").textContent = String(studyOverview?.due_review_count ?? 0);
  renderRecentStudyList("accountRecentBookmarks", studyOverview?.recent_bookmarks || [], "Nenhum bookmark salvo ainda.");
  renderRecentStudyList("accountRecentNotes", studyOverview?.recent_notes || [], "Nenhuma nota salva ainda.");
  renderRecentStudyList("accountDueReviews", studyOverview?.due_reviews || [], "Nenhuma revisao vencida no momento.");
  const queueBtn = el("btn-start-review-queue");
  if(queueBtn){
    const dueCount = Number(studyOverview?.due_review_count || 0);
    const totalQueued = Number(reviewQueueSnapshot?.total_count || dueCount || 0);
    queueBtn.disabled = totalQueued <= 0;
    queueBtn.textContent = dueCount > 0 ? `Revisao diaria (${dueCount} vencidas)` : "Revisao diaria";
  }
}

async function loadReviewQueueSnapshot(silent = true){
  try{
    reviewQueueSnapshot = await apiGet("/study/review/queue");
  }catch(e){
    reviewQueueSnapshot = null;
    if(!silent){
      el("accountNotice").textContent = `Nao foi possivel carregar a fila de revisao: ${e.message}`;
    }
  }
}

async function loadStudyOverview(silent = false){
  try{
    studyOverview = await apiGet("/study/overview");
    await loadReviewQueueSnapshot(true);
  }catch(e){
    studyOverview = {
      scope: currentUser ? "user" : "device",
      bookmark_count: 0,
      note_count: 0,
      due_review_count: 0,
      next_due_at: null,
      recent_bookmarks: [],
      recent_notes: [],
      due_reviews: []
    };
    reviewQueueSnapshot = null;
    if(!silent){
      el("accountNotice").textContent = `Nao foi possivel carregar o resumo de estudo: ${e.message}`;
    }
  }
  renderAccountCard();
}

async function loadAuthState(){
  const token = getStoredAuthToken();
  if(!token){
    currentUser = null;
    await loadStudyOverview(true);
    renderAccountCard();
    return;
  }

  try{
    currentUser = await apiGet("/auth/me");
    el("accountNotice").textContent = "Conta autenticada. O progresso desta sessao fica vinculado ao seu perfil.";
  }catch(e){
    clearStoredAuthToken();
    currentUser = null;
    el("accountNotice").textContent = "Sessao anterior expirada. Continuando com o escopo local deste dispositivo.";
  }
  await loadStudyOverview(true);
  renderAccountCard();
}

function clearAuthForms(){
  ["loginEmail", "loginPassword", "registerName", "registerEmail", "registerPassword"].forEach((id) => {
    const node = el(id);
    if(node) node.value = "";
  });
}

async function applyAuthSuccess(payload, successMessage){
  if(!payload || !payload.token || !payload.user){
    throw new Error("Resposta de autenticacao invalida.");
  }
  setStoredAuthToken(payload.token);
  currentUser = payload.user;
  clearAuthForms();
  el("accountNotice").textContent = successMessage;
  await loadStudyOverview(true);
  renderAccountCard();
  await checkResume();
  await loadHistory();
}

async function submitLogin(ev){
  ev.preventDefault();
  const email = (el("loginEmail").value || "").trim();
  const password = el("loginPassword").value || "";
  if(!email || !password){
    el("accountNotice").textContent = "Informe email e senha para entrar.";
    return;
  }
  try{
    const payload = await apiPost("/auth/login", { email, password });
    await applyAuthSuccess(payload, "Login concluido. Suas sessoes e notas locais foram sincronizadas quando aplicavel.");
    showToast("Conta conectada.");
  }catch(e){
    el("accountNotice").textContent = `Falha no login: ${e.message}`;
  }
}

async function submitRegister(ev){
  ev.preventDefault();
  const displayName = (el("registerName").value || "").trim();
  const email = (el("registerEmail").value || "").trim();
  const password = el("registerPassword").value || "";
  if(!email || !password){
    el("accountNotice").textContent = "Preencha ao menos email e senha para criar a conta.";
    return;
  }
  try{
    const payload = await apiPost("/auth/register", {
      display_name: displayName || null,
      email,
      password
    });
    await applyAuthSuccess(payload, "Conta criada. O progresso deste dispositivo foi associado ao novo usuario.");
    showToast("Conta criada.");
  }catch(e){
    el("accountNotice").textContent = `Falha ao criar conta: ${e.message}`;
  }
}

async function logoutCurrentUser(){
  try{
    await apiRequest("/auth/logout", { method: "POST" });
  }catch(e){
    // Best effort. Token may already be invalid.
  }
  clearStoredAuthToken();
  currentUser = null;
  el("accountNotice").textContent = "Sessao encerrada. O app voltou ao escopo local deste dispositivo.";
  await loadStudyOverview(true);
  renderAccountCard();
  await checkResume();
  await loadHistory();
}

function refreshStudyMeta(statusMessage){
  const scope = currentStudyState?.scope || (currentUser ? "user" : "device");
  el("studyScopeCopy").textContent = scope === "user"
    ? "Este status fica salvo na sua conta e sincroniza com outros dispositivos."
    : "Este status fica salvo somente neste dispositivo ate voce entrar em uma conta.";

  const badge = el("studySyncBadge");
  if(studyStateDirty){
    badge.textContent = "Pendente";
  }else if(currentStudyState?.updated_at){
    badge.textContent = "Salvo";
  }else{
    badge.textContent = "Sem registros";
  }

  const message = statusMessage
    || (studyStateDirty
      ? "Voce tem alteracoes nao salvas nesta questao."
      : currentStudyState?.updated_at
        ? `Ultima sincronizacao em ${formatDateTime(currentStudyState.updated_at)}.`
        : "Nenhum bookmark ou nota salvos para esta questao ainda.");
  el("studyNotice").textContent = message;
}

function applyStudyStateToForm(state, statusMessage){
  currentStudyState = state || {
    question_id: currentQuestion?.id || "",
    bookmarked: false,
    note_text: null,
    updated_at: null,
    scope: currentUser ? "user" : "device"
  };
  studyStateDirty = false;
  el("studyBookmark").checked = !!currentStudyState.bookmarked;
  el("studyNote").value = currentStudyState.note_text || "";
  refreshStudyMeta(statusMessage);
}

function resetStudyStateForQuestion(questionId){
  currentStudyQuestionId = questionId;
  applyStudyStateToForm({
    question_id: questionId,
    bookmarked: false,
    note_text: null,
    updated_at: null,
    scope: currentUser ? "user" : "device"
  }, "Carregando status de estudo...");
  el("studySyncBadge").textContent = "Carregando";
}

function markStudyStateDirty(){
  studyStateDirty = true;
  refreshStudyMeta();
}

async function loadCurrentQuestionStudyState(questionId){
  if(!questionId){
    return;
  }
  resetStudyStateForQuestion(questionId);
  try{
    const state = await apiGet(`/study/questions/${questionId}/state`);
    if(currentStudyQuestionId !== questionId){
      return;
    }
    applyStudyStateToForm(state);
  }catch(e){
    if(currentStudyQuestionId !== questionId){
      return;
    }
    applyStudyStateToForm({
      question_id: questionId,
      bookmarked: false,
      note_text: null,
      updated_at: null,
      scope: currentUser ? "user" : "device"
    }, `Nao foi possivel carregar o status de estudo: ${e.message}`);
    el("studySyncBadge").textContent = "Erro";
  }
}

async function saveCurrentStudyState({ silent = false } = {}){
  if(!currentQuestion){
    return true;
  }
  const questionId = currentQuestion.id;
  const payload = {
    bookmarked: !!el("studyBookmark").checked,
    note_text: (el("studyNote").value || "").trim() || null
  };
  try{
    const state = await apiPut(`/study/questions/${questionId}/state`, payload);
    if(currentQuestion?.id !== questionId){
      return true;
    }
    applyStudyStateToForm(state);
    await loadStudyOverview(true);
    if(!silent){
      showToast("Status de estudo salvo.");
    }
    return true;
  }catch(e){
    if(currentQuestion?.id === questionId){
      el("studySyncBadge").textContent = "Erro";
      el("studyNotice").textContent = `Erro ao salvar: ${e.message}`;
    }
    if(!silent){
      showToast("Nao foi possivel salvar o status de estudo.");
    }
    return false;
  }
}

async function ensureStudyStateSaved(){
  if(!studyStateDirty){
    return true;
  }
  return saveCurrentStudyState({ silent: true });
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

  const studyHistExam = el("studyHistoryExam");
  studyHistExam.innerHTML = "<option value=\"\">Todas</option>";
  exams.forEach(ex => {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.title;
    studyHistExam.appendChild(opt);
  });

  updateModeUi(getSelectedMode());
  await loadAuthState();
  await loadDomainOptions(sel.value || "");
  await checkResume();
  await loadHistory();
}

function renderDomainOptions(payload){
  const subjectSelect = el("subjectSelect");
  const hint = el("subjectHint");
  const domains = Array.isArray(payload?.domains) ? payload.domains : [];
  const examId = payload?.exam_id || "";

  subjectSelect.innerHTML = "<option value=\"\">Todos os assuntos</option>";
  domains.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = `${item.label} (${item.question_count} questoes)`;
    subjectSelect.appendChild(opt);
  });

  if(domains.length === 0){
    hint.textContent = "Nao ha dominios suficientes para este filtro.";
  }else if(examId){
    hint.textContent = "Opcional. Restrinja a prova a um dominio da certificacao selecionada.";
  }else{
    hint.textContent = "Opcional. No modo misto, o filtro cruza os dominios equivalentes entre as provas.";
  }
}

async function loadDomainOptions(examId){
  const cacheKey = examId || "__all__";
  if(domainCatalogCache.has(cacheKey)){
    renderDomainOptions(domainCatalogCache.get(cacheKey));
    return;
  }
  try{
    const suffix = examId ? `?exam_id=${encodeURIComponent(examId)}` : "";
    const payload = await apiGet(`/domains${suffix}`);
    domainCatalogCache.set(cacheKey, payload);
    renderDomainOptions(payload);
  }catch(e){
    el("subjectSelect").innerHTML = "<option value=\"\">Todos os assuntos</option>";
    el("subjectHint").textContent = "Nao foi possivel carregar os assuntos agora.";
  }
}

function renderQuestion(payload){
  currentQuestion = payload.question;
  questionStartedAt = Date.now();
  const idx = payload.progress_index + 1;
  const total = payload.total_questions;

  el("pill-progress").textContent = `Questao ${idx}/${total}`;
  el("qtitle").textContent = `Questao ${idx}`;
  el("qsub").textContent = currentQuestion.multi_select ? "Selecione TODAS as alternativas corretas." : "Selecione a alternativa correta.";
  el("pill-target").textContent = isStudyMode()
    ? `${formatStudyStrategy(currentStudyStrategy)} · revisao imediata`
    : "Meta: >= 90%";
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
  loadCurrentQuestionStudyState(currentQuestion.id).catch((err) => {
    el("studyNotice").textContent = `Nao foi possivel carregar o status de estudo: ${err.message}`;
  });
}

function selectedKeys(){
  const nodes = el("optionsForm").querySelectorAll("input[name='opt']:checked");
  return Array.from(nodes).map(n => n.value);
}

async function fetchNext(){
  const payload = await apiGet(`${currentSessionApiBase()}/${sessionId}/next`);
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
  if(fb.next_review_at) liveBits.push(`Rever em: ${formatDateTime(fb.next_review_at)}`);
  if(fb.review_due_count !== undefined && isStudyMode()) liveBits.push(`Fila vencida: ${fb.review_due_count}`);
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
    const label = item.question_number ? `Questao ${item.question_number}` : (item.id || "Questao");
    elItem.innerHTML = `
      <div class="title">${escapeHtml(label)}${meta ? ` · ${escapeHtml(meta)}` : ""}</div>
      <div class="body">${escapeHtml(item.prompt)}</div>
    `;
    wrap.appendChild(elItem);
  });
}

async function showResult(){
  const res = await apiGet(`${currentSessionApiBase()}/${sessionId}/result`);
  lastCompletedSessionId = res.session_id;
  lastCompletedSessionMode = currentSessionMode;
  const studyMode = isStudyMode();
  const studyStrategy = formatStudyStrategy(res.strategy);

  el("resScore").textContent = `${res.score_percent.toFixed(2)}%`;
  el("resCorrect").textContent = String(res.correct_count);
  el("resWrong").textContent = String(res.wrong_count);
  el("resStatus").textContent = studyMode
    ? "ESTUDO CONCLUIDO"
    : (res.passed ? "APROVADO (>= 90%)" : "REPROVADO (< 90%)");

  const summary = res.insight?.summary || {};
  const weakest = Array.isArray(res.insight?.weakest_domains) ? res.insight.weakest_domains[0] : null;
  if(studyMode){
    el("resultSubtitle").textContent = res.review_due_count
      ? `${studyStrategy} concluida. Sua fila tem ${res.review_due_count} revisao(oes) vencida(s).`
      : `${studyStrategy} concluida. Continue alimentando a fila de revisao com consistencia.`;
  }else{
    el("resultSubtitle").textContent = weakest
      ? `Area com mais erros: ${weakest.label} (${weakest.wrong} erro(s)).`
      : "Veja seu desempenho geral e os principais insights.";
  }
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

  clearStoredSession(currentSessionMode);
  currentQuestion = null;
  currentStudyQuestionId = null;
  studyStateDirty = false;
  questionStartedAt = null;
  el("btn-review").classList.toggle("hidden", studyMode);
  el("btn-retry-wrong").classList.toggle("hidden", studyMode);
  el("btn-restart").textContent = studyMode ? "Novo bloco" : "Nova prova";
  show("screen-result");
  await loadStudyOverview(true);
  await loadHistory();
}

async function beginSession(payload, mode = "exam", startPath = null){
  currentSessionMode = mode === "study" ? "study" : "exam";
  el("startNotice").textContent = "";
  el("quizNotice").textContent = "";
  try{
    const targetPath = startPath || `${currentSessionApiBase(currentSessionMode)}`;
    const s = await apiPost(targetPath, payload);
    sessionId = s.id;
    currentStudyStrategy = currentSessionMode === "study" ? (s.selection_strategy || payload.strategy || "standard") : "standard";
    writeStoredSession(currentSessionMode, sessionId);
    clearStoredSession(currentSessionMode === "study" ? "exam" : "study");
    setScorePills(s.correct_count, s.wrong_count);
    resetStudyEditorUi();
    show("screen-quiz");
    await fetchNext();
    return true;
  }catch(e){
    el("startNotice").textContent = `Erro: ${e.message}`;
    return false;
  }
}

function getRequestedTotal(defaultValue){
  const parsed = parseInt(el("totalQuestions").value || "", 10);
  if(Number.isFinite(parsed) && parsed > 0){
    return parsed;
  }
  return defaultValue;
}

async function start(){
  const mode = getSelectedMode();
  const examId = el("examSelect").value || null;
  const totalQuestions = getRequestedTotal(mode === "study" ? 30 : 90);
  const subject = el("subjectSelect").value || "";
  const payload = { exam_id: examId, total_questions: totalQuestions };
  if(mode === "study"){
    payload.strategy = el("studyStrategySelect").value || "standard";
  }
  if(subject){
    payload.domains = [subject];
  }
  await beginSession(payload, mode);
}

async function startDueReviewSession(){
  const examId = el("examSelect").value || null;
  const defaultTotal = Number(reviewQueueSnapshot?.recommended_batch_size || 10) || 10;
  const totalQuestions = getRequestedTotal(defaultTotal);
  const subject = el("subjectSelect").value || "";
  const payload = { exam_id: examId, total_questions: totalQuestions, strategy: "review", queue_only: true };
  if(subject){
    payload.domains = [subject];
  }
  await beginSession(payload, "study", "/study/review/sessions");
}

async function checkResume(){
  const candidates = [
    { mode: "study", id: readStorage(STUDY_STORAGE_KEY) },
    { mode: "exam", id: readStorage(STORAGE_KEY) }
  ].filter((item) => !!item.id);
  if(candidates.length === 0){
    el("continueBox").classList.add("hidden");
    return;
  }

  for(const candidate of candidates){
    try{
      const state = await apiGet(`${currentSessionApiBase(candidate.mode)}/${candidate.id}`);
      if(state.finished){
        clearStoredSession(candidate.mode);
        continue;
      }
      const examTitle = state.exam_id ? (examMap.get(state.exam_id)?.title || state.exam_id) : "Misturar todas";
      const label = candidate.mode === "study" ? "Estudo" : "Prova";
      const strategyMeta = candidate.mode === "study" ? ` · ${formatStudyStrategy(state.selection_strategy)}` : "";
      el("continueMeta").textContent = `${label}: ${examTitle}${strategyMeta} · Questao ${state.current_index + 1}/${state.total_questions} · Acertos ${state.correct_count}`;
      el("continueBox").classList.remove("hidden");
      el("btn-continue").onclick = async () => {
        currentSessionMode = candidate.mode;
        currentStudyStrategy = candidate.mode === "study" ? (state.selection_strategy || "standard") : "standard";
        sessionId = candidate.id;
        setScorePills(state.correct_count, state.wrong_count);
        show("screen-quiz");
        await fetchNext();
      };
      el("btn-discard").onclick = () => {
        clearStoredSession(candidate.mode);
        el("continueBox").classList.add("hidden");
      };
      return;
    }catch(e){
      clearStoredSession(candidate.mode);
    }
  }

  el("continueBox").classList.add("hidden");
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

function renderDependencyInsights(snapshot){
  const wrap = el("dependencyInsights");
  if(!wrap) return;
  wrap.innerHTML = "";

  const certs = Array.isArray(snapshot?.certifications) ? snapshot.certifications : [];
  const meaningful = certs.filter(item => (item?.attempted || 0) > 0);
  if(meaningful.length === 0){
    wrap.innerHTML = '<div class="empty">Conclua algumas questoes para ver quais areas exigem mais estudo.</div>';
    return;
  }

  meaningful.forEach((item) => {
    const card = document.createElement("div");
    card.className = "dependency-card";
    const focus = item.focus_domain || null;
    const domains = Array.isArray(item.domains) ? item.domains.slice(0, 4) : [];
    const bars = domains.length ? domains.map((domain) => {
      const weakness = Math.max(8, 100 - Number(domain.score_percent || 0));
      const width = Math.min(100, Math.max(12, weakness));
      return `
        <div class="dependency-row">
          <div class="dependency-row-head">
            <span>${escapeHtml(domain.label || "Sem dominio")}</span>
            <span>${domain.wrong ?? 0} erro(s)</span>
          </div>
          <div class="dependency-bar-track">
            <div class="dependency-bar-fill" style="width:${width}%"></div>
          </div>
          <div class="dependency-row-meta">${formatScore(domain.score_percent ?? 0)} de acerto em ${domain.total ?? 0} questoes</div>
        </div>
      `;
    }).join("") : '<div class="empty">Sem dominios suficientes.</div>';

    card.innerHTML = `
      <div class="dependency-head">
        <div>
          <div class="dependency-title">${escapeHtml(item.certification || "Sem certificacao")}</div>
          <div class="dependency-meta">${item.attempted ?? 0} questoes respondidas · ${item.wrong ?? 0} erros</div>
        </div>
        <div class="dependency-focus">${focus ? escapeHtml(focus.label || "Sem dominio") : "-"}</div>
      </div>
      <div class="dependency-copy">${escapeHtml(item.message || "Sem historico suficiente para este track.")}</div>
      <div class="dependency-bars">${bars}</div>
    `;
    wrap.appendChild(card);
  });
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

function getStudyHistoryFilters(){
  const query = (el("studyHistorySearch").value || "").toLowerCase();
  const exam = el("studyHistoryExam").value || "";
  const strategy = el("studyHistoryStrategy").value || "";
  const minScore = el("studyHistoryMinScore").value ? parseFloat(el("studyHistoryMinScore").value) : null;
  return { query, exam, strategy, minScore };
}

function renderStudyHistorySummary(items){
  const total = items.length;
  const avgScore = total ? items.reduce((sum, item) => sum + (item.score_percent || 0), 0) / total : 0;
  const timedItems = items.filter(item => item.avg_seconds_per_question !== null && item.avg_seconds_per_question !== undefined);
  const avgPace = timedItems.length
    ? timedItems.reduce((sum, item) => sum + (item.avg_seconds_per_question || 0), 0) / timedItems.length
    : null;
  const lowConfidence = items.reduce((sum, item) => sum + (item.confidence_low || 0), 0);
  const reviewBlocks = items.filter(item => item.selection_strategy === "review").length;
  renderInsightCards("studyHistorySummary", [
    { label: "Blocos concluidos", value: total },
    { label: "Score medio", value: total ? formatScore(avgScore) : "-" },
    { label: "Baixa confianca", value: lowConfidence },
    { label: "Tempo medio/questao", value: avgPace !== null ? `${avgPace.toFixed(1)}s` : "-" },
    { label: "Revisoes diarias", value: reviewBlocks }
  ]);
}

function renderStudyHistory(){
  const list = el("studyHistoryList");
  const empty = el("studyHistoryEmpty");
  const filters = getStudyHistoryFilters();
  const filtered = studyHistoryItems.filter(item => {
    const title = (item.exam_title || item.exam_id || "Misturar todas").toLowerCase();
    const id = (item.id || "").toLowerCase();
    const strategyLabel = formatStudyStrategy(item.selection_strategy).toLowerCase();
    if(filters.query && !title.includes(filters.query) && !id.includes(filters.query) && !strategyLabel.includes(filters.query)) return false;
    if(filters.exam && item.exam_id !== filters.exam) return false;
    if(filters.strategy && item.selection_strategy !== filters.strategy) return false;
    if(filters.minScore !== null && (item.score_percent ?? 0) < filters.minScore) return false;
    return true;
  });

  el("studyHistoryCount").textContent = `${filtered.length} bloco(s) no historico de estudo`;
  renderStudyHistorySummary(filtered);
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
    const weakest = Array.isArray(item.weakest_domains) ? item.weakest_domains.slice(0, 3) : [];
    const mix = item.selection_mix && typeof item.selection_mix === "object"
      ? Object.entries(item.selection_mix).filter(([, amount]) => Number(amount) > 0).map(([label, amount]) => `${label}: ${amount}`).join(" | ")
      : "";
    const weakChips = weakest.length
      ? `<div class="chip-grid" style="margin-top:10px;">${weakest.map(label => `<div class="chip">${escapeHtml(label)}</div>`).join("")}</div>`
      : "";
    row.innerHTML = `
      <div>
        <div class="history-title">${escapeHtml(examTitle)}</div>
        <div class="history-meta">${formatDate(item.completed_at || item.created_at)} · ${formatStudyStrategy(item.selection_strategy)} · ${item.total_questions} questoes · ${formatScore(item.score_percent)} · ${item.confidence_low || 0} chutei</div>
        ${mix ? `<div class="history-meta">${escapeHtml(mix)}</div>` : ""}
        ${weakChips}
      </div>
      <div class="history-actions">
        <button class="btn btn-ghost" data-action="study-review" data-id="${item.id}" type="button" aria-haspopup="dialog">Detalhes</button>
        <span class="badge badge-outline">${formatStudyStrategy(item.selection_strategy)}</span>
        <span class="badge">${item.avg_seconds_per_question !== null && item.avg_seconds_per_question !== undefined ? `${item.avg_seconds_per_question}s` : "-"}</span>
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
  }
  renderHeroStats();
  renderHistory();
  await loadWeakAreaSnapshot();
  await loadStudyHistory();
  await loadStudyWeeklyAnalytics();
}

async function loadStudyHistory(){
  try{
    studyHistoryItems = await apiGet("/study/history?limit=200");
  }catch(e){
    studyHistoryItems = [];
    el("studyHistoryCount").textContent = "Nao foi possivel carregar o historico de estudo.";
  }
  renderStudyHistory();
}

async function loadWeakAreaSnapshot(){
  try{
    weakAreaSnapshot = await apiGet("/analytics/weak-areas");
  }catch(e){
    weakAreaSnapshot = null;
  }
  renderDependencyInsights(weakAreaSnapshot);
}

function renderWeeklyAnalytics(payload){
  studyWeeklyAnalytics = payload || null;
  const summary = payload?.summary || {};
  const weeks = Array.isArray(payload?.weeks) ? payload.weeks : [];
  renderInsightCards("weeklySummary", [
    { label: "Questoes nas semanas", value: summary.total_questions ?? 0 },
    { label: "Revisoes respondidas", value: summary.review_questions ?? 0 },
    { label: "Media de acerto", value: summary.average_accuracy_percent !== undefined ? `${Number(summary.average_accuracy_percent).toFixed(2)}%` : "-" },
    { label: "Backlog vencido", value: summary.review_backlog_due ?? 0 },
    { label: "Delta semanal", value: summary.accuracy_delta_vs_previous_week !== undefined ? `${summary.accuracy_delta_vs_previous_week > 0 ? "+" : ""}${Number(summary.accuracy_delta_vs_previous_week).toFixed(2)} pts` : "-" }
  ]);

  const wrap = el("weeklyRows");
  wrap.innerHTML = "";
  if(weeks.length === 0){
    wrap.className = "weekly-list empty";
    wrap.textContent = "Sem dados suficientes para montar o ritmo semanal ainda.";
    return;
  }
  wrap.className = "weekly-list";
  const maxVolume = weeks.reduce((acc, item) => Math.max(acc, Number(item.study_questions || 0), Number(item.scheduled_reviews || 0)), 1);
  weeks.forEach((item) => {
    const card = document.createElement("div");
    card.className = "weekly-item";
    const studyWidth = Math.max(8, Math.round((Number(item.study_questions || 0) / maxVolume) * 100));
    const reviewWidth = Math.max(8, Math.round((Number(item.scheduled_reviews || 0) / maxVolume) * 100));
    card.innerHTML = `
      <div class="weekly-head">
        <div>
          <div class="weekly-title">${escapeHtml(item.label || item.week_start || "Semana")}</div>
          <div class="weekly-meta">${item.completed_sessions || 0} bloco(s) · ${item.review_sessions || 0} revisao(oes) dedicadas · ${Number(item.accuracy_percent || 0).toFixed(2)}%</div>
        </div>
        <span class="badge badge-outline">${item.low_confidence || 0} chutei</span>
      </div>
      <div class="weekly-bars">
        <div>
          <div class="weekly-caption">Volume estudado: ${item.study_questions || 0} questoes</div>
          <div class="weekly-bar-track"><div class="weekly-bar-fill" style="width:${item.study_questions ? studyWidth : 0}%"></div></div>
        </div>
        <div>
          <div class="weekly-caption">Revisoes agendadas: ${item.scheduled_reviews || 0}</div>
          <div class="weekly-bar-track"><div class="weekly-bar-fill" style="width:${item.scheduled_reviews ? reviewWidth : 0}%; opacity:.72;"></div></div>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  });
}

async function loadStudyWeeklyAnalytics(){
  try{
    const payload = await apiGet("/study/analytics/weekly?weeks=8");
    renderWeeklyAnalytics(payload);
  }catch(e){
    renderWeeklyAnalytics(null);
    el("weeklyRows").className = "weekly-list empty";
    el("weeklyRows").textContent = "Nao foi possivel carregar as metricas semanais agora.";
  }
}

function renderTrend(targetId, items, sessionIdValue){
  const wrap = el(targetId);
  wrap.innerHTML = "";
  if(!Array.isArray(items) || items.length === 0){
    wrap.innerHTML = "<div class=\"muted\">Sem dados suficientes para tendencia.</div>";
    return;
  }
  const sorted = [...items].sort((a, b) => new Date(a.completed_at || a.created_at) - new Date(b.completed_at || b.created_at));
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

function renderReviewQuestions(questions, { targetId = "reviewQuestions", showStudyMeta = false } = {}){
  const wrap = el(targetId);
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
    const citations = Array.isArray(q.citations) ? q.citations : [];
    const citationLines = citations
      .map((citation) => {
        const text = formatCitationText(citation);
        const previewUrl = buildMaterialPreviewUrl(citation);
        return { text, previewUrl };
      })
      .filter((item) => item.text)
      .slice(0, 4);
    const citationHtml = citationLines.length
      ? `
        <div class="review-citations">
          <div class="review-citations-title">Onde revisar</div>
          ${citationLines.map((item) => `
            <div class="review-citation-row">
              <div class="review-citation">${escapeHtml(item.text)}</div>
              ${item.previewUrl ? `<a class="review-citation-link" href="${escapeHtml(item.previewUrl)}" target="_blank" rel="noopener noreferrer">Abrir trecho</a>` : ""}
            </div>
          `).join("")}
        </div>
      `
      : "";
    const questionNumber = q.question_number || (idx + 1);
    const studyBits = [];
    if(showStudyMeta && q.confidence_level){
      const confidenceLabel = q.confidence_level === "low"
        ? "Chutei"
        : (q.confidence_level === "high" ? "Tenho certeza" : "Razoavel");
      studyBits.push(`Confianca: ${confidenceLabel}`);
    }
    if(showStudyMeta && q.elapsed_seconds !== null && q.elapsed_seconds !== undefined){
      studyBits.push(`Tempo: ${formatDuration(q.elapsed_seconds)}`);
    }
    if(showStudyMeta && q.answered_at){
      studyBits.push(`Respondida: ${formatDateTime(q.answered_at)}`);
    }
    const studyMeta = studyBits.length
      ? `<div class="muted" style="margin-top:10px;">${escapeHtml(studyBits.join(" · "))}</div>`
      : "";

    item.innerHTML = `
      <div class="review-header">
        <div>
          <div class="review-title">Questao ${questionNumber}</div>
          <div class="muted">${escapeHtml(q.prompt)}</div>
        </div>
        <span class="${badgeClass}">${badgeText}</span>
      </div>
      <div class="review-options">${optionsHtml}</div>
      <div class="muted" style="margin-top:10px;">Sua resposta: ${escapeHtml(q.selected_keys.join(", ") || "-")} · Correta: ${escapeHtml(q.correct_keys.join(", ") || "-")}</div>
      ${studyMeta}
      ${tags}
      ${citationHtml}
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

  renderTrend("reviewTrend", historyItems, data.session.id);
  renderReviewQuestions(data.questions || []);

  const favoriteBtn = el("btn-review-favorite");
  const favActive = isFavorite(data.session.id);
  favoriteBtn.textContent = favActive ? "Remover favorito" : "Salvar como favorito";
  favoriteBtn.setAttribute("aria-pressed", favActive);
}

function renderStudyReviewModal(data){
  const examTitle = data.session.exam_title || (data.session.exam_id ? data.session.exam_id : "Misturar todas");
  el("studyReviewTitle").textContent = `Revisao - ${examTitle}`;
  el("studyReviewMeta").textContent = `${formatDateTime(data.session.completed_at || data.session.created_at)} · ${formatStudyStrategy(data.session.selection_strategy)} · Score ${formatScore(data.session.score_percent)} · ${data.session.total_questions} questoes`;

  const summary = data.result.insight?.summary || {};
  renderInsightCards("studyReviewSummary", [
    { label: "Score", value: `${data.result.score_percent}%` },
    { label: "Acertos", value: data.result.correct_count },
    { label: "Erros", value: data.result.wrong_count },
    { label: "Tempo total", value: formatDuration(summary.duration_seconds) },
    { label: "Media por questao", value: summary.avg_seconds_per_question ? `${summary.avg_seconds_per_question}s` : "-" },
    { label: "Chutei", value: data.session.confidence_low ?? 0 }
  ]);

  const byType = data.result.insight?.by_type || {};
  renderInsightCards("studyReviewByType", [
    { label: "Single-select", value: `${byType.single_select?.score_percent ?? 0}% (${byType.single_select?.correct ?? 0}/${byType.single_select?.total ?? 0})` },
    { label: "Multi-select", value: `${byType.multi_select?.score_percent ?? 0}% (${byType.multi_select?.correct ?? 0}/${byType.multi_select?.total ?? 0})` }
  ]);

  renderDomainBreakdown("studyReviewByDomain", data.result.insight?.by_domain || {}, "Sem dados de dominio/tema.");
  renderTrend("studyReviewTrend", studyHistoryItems, data.session.id);
  renderReviewQuestions(data.questions || [], { targetId: "studyReviewQuestions", showStudyMeta: true });
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

function openStudyReviewModal(sessionIdValue){
  focusReturnEl = document.activeElement;
  apiGet(`/study/sessions/${sessionIdValue}/review`).then(data => {
    activeStudyReview = data;
    renderStudyReviewModal(data);
    const modal = el("studyReviewModal");
    modal.classList.remove("hidden");
    setModalState(true);
    trapFocus(modal);
    el("btn-study-review-close").focus();
  }).catch(err => {
    showToast(`Erro ao carregar o bloco de estudo: ${err.message}`);
  });
}

function closeStudyReviewModal(){
  const modal = el("studyReviewModal");
  modal.classList.add("hidden");
  setModalState(false);
  activeStudyReview = null;
  if(focusReturnEl && typeof focusReturnEl.focus === "function"){
    focusReturnEl.focus();
  }
}

async function retryStudyReviewWrong(){
  if(!activeStudyReview || !Array.isArray(activeStudyReview.questions)){
    showToast("Revisao de estudo indisponivel.");
    return;
  }
  const wrongIds = activeStudyReview.questions.filter(q => q.is_correct === false).map(q => q.id);
  if(wrongIds.length === 0){
    showToast("Nenhuma questao errada para reestudar.");
    return;
  }
  const review = activeStudyReview;
  closeStudyReviewModal();
  await beginSession({
    exam_id: review.session.exam_id,
    total_questions: wrongIds.length,
    question_ids: wrongIds
  }, "study");
}

async function retryStudyReviewFull(){
  if(!activeStudyReview || !Array.isArray(activeStudyReview.questions)){
    showToast("Revisao de estudo indisponivel.");
    return;
  }
  const ids = activeStudyReview.questions.map(q => q.id);
  if(ids.length === 0){
    showToast("Bloco vazio.");
    return;
  }
  const review = activeStudyReview;
  closeStudyReviewModal();
  await beginSession({
    exam_id: review.session.exam_id,
    total_questions: ids.length,
    question_ids: ids
  }, "study");
}

function exportStudyReview(){
  if(!activeStudyReview || !activeStudyReview.session?.id){
    showToast("Revisao de estudo indisponivel.");
    return;
  }
  const blob = new Blob([JSON.stringify(activeStudyReview, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sentinel_study_review_${activeStudyReview.session.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
el("btn-start-review-queue").addEventListener("click", startDueReviewSession);
el("loginForm").addEventListener("submit", submitLogin);
el("registerForm").addEventListener("submit", submitRegister);
el("btn-logout").addEventListener("click", logoutCurrentUser);
el("studyBookmark").addEventListener("change", markStudyStateDirty);
el("studyNote").addEventListener("input", markStudyStateDirty);
el("btn-study-save").addEventListener("click", () => saveCurrentStudyState());
el("btn-study-reload").addEventListener("click", () => {
  if(!currentQuestion){
    refreshStudyMeta("Nenhuma questao ativa agora.");
    return;
  }
  loadCurrentQuestionStudyState(currentQuestion.id);
});

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
    const payload = {
      question_id: currentQuestion.id,
      selected_keys: keys
    };
    if(isStudyMode()){
      const elapsedSeconds = questionStartedAt ? Math.max(0, Math.round((Date.now() - questionStartedAt) / 1000)) : null;
      payload.confidence_level = el("confidenceSelect").value || "medium";
      payload.elapsed_seconds = elapsedSeconds;
    }
    const fb = await apiPost(`${currentSessionApiBase()}/${sessionId}/answer`, payload);
    showFeedback(fb, keys);
    if(isStudyMode()){
      await loadStudyOverview(true);
    }
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
  const saved = await ensureStudyStateSaved();
  if(!saved){
    return;
  }
  if(el("btn-next").textContent.toLowerCase().includes("resultado")){
    await showResult();
    return;
  }
  await fetchNext();
});

el("btn-restart").addEventListener("click", () => {
  sessionId = null;
  currentQuestion = null;
  currentSessionMode = getSelectedMode();
  currentStudyStrategy = "standard";
  questionStartedAt = null;
  resetStudyEditorUi();
  el("btn-review").classList.remove("hidden");
  el("btn-retry-wrong").classList.remove("hidden");
  el("btn-restart").textContent = "Nova prova";
  show("screen-start");
});

el("btn-review").addEventListener("click", () => {
  if(lastCompletedSessionMode !== "exam"){
    showToast("A revisao detalhada por modal ainda se aplica apenas ao exam mode.");
    return;
  }
  if(!lastCompletedSessionId){
    showToast("Nenhuma revisao disponivel.");
    return;
  }
  openReviewModal(lastCompletedSessionId);
});

el("btn-retry-wrong").addEventListener("click", async () => {
  if(lastCompletedSessionMode !== "exam"){
    await startDueReviewSession();
    return;
  }
  if(!lastCompletedSessionId){
    showToast("Nenhuma revisao disponivel.");
    return;
  }
  await retryWrong(lastCompletedSessionId);
});

el("btn-reset").addEventListener("click", () => {
  sessionId = null;
  currentQuestion = null;
  clearStoredSession("exam");
  clearStoredSession("study");
  location.reload();
});

el("btn-history-refresh").addEventListener("click", loadHistory);
el("btn-study-history-refresh").addEventListener("click", async () => {
  await loadStudyHistory();
  await loadStudyWeeklyAnalytics();
});
el("modeSelect").addEventListener("change", () => {
  updateModeUi(getSelectedMode());
});

el("examSelect").addEventListener("change", () => {
  el("subjectSelect").value = "";
  loadDomainOptions(el("examSelect").value || "");
});

el("historySearch").addEventListener("input", renderHistory);
el("historyExam").addEventListener("change", renderHistory);
el("historyMinScore").addEventListener("change", renderHistory);
el("historyFrom").addEventListener("change", renderHistory);
el("historyTo").addEventListener("change", renderHistory);
el("studyHistorySearch").addEventListener("input", renderStudyHistory);
el("studyHistoryExam").addEventListener("change", renderStudyHistory);
el("studyHistoryStrategy").addEventListener("change", renderStudyHistory);
el("studyHistoryMinScore").addEventListener("change", renderStudyHistory);

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

el("studyHistoryList").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-action='study-review']");
  if(!btn) return;
  openStudyReviewModal(btn.dataset.id);
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

el("btn-study-review-close").addEventListener("click", closeStudyReviewModal);

el("studyReviewModal").addEventListener("click", (ev) => {
  if(ev.target && ev.target.dataset.closeStudyReview === "true"){
    closeStudyReviewModal();
  }
});

el("studyReviewModal").addEventListener("keydown", (ev) => {
  if(ev.key === "Escape"){
    closeStudyReviewModal();
  }
});

el("btn-study-review-retry-wrong").addEventListener("click", retryStudyReviewWrong);
el("btn-study-review-retry-full").addEventListener("click", retryStudyReviewFull);
el("btn-study-review-export").addEventListener("click", exportStudyReview);

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

window.SentinelAuth = {
  getToken: getStoredAuthToken,
  setToken: async (token) => {
    setStoredAuthToken(token);
    await loadAuthState();
    await checkResume();
    await loadHistory();
    return getStoredAuthToken();
  },
  clearToken: async () => {
    clearStoredAuthToken();
    handleAuthTokenCleared();
    await loadStudyOverview(true);
    await checkResume();
    await loadHistory();
  },
  getClientKey: getOrCreateClientKey,
  getUser: () => currentUser,
  logout: logoutCurrentUser,
  refresh: loadAuthState
};

loadExams().catch(console.error);
