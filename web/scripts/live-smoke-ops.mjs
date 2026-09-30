// Sentinel Arena Incremento 3 real-browser smoke test: rehearsal with bots started from the
// editor dialog, per-participant extended time, host pause/resume/extend, and a phone whose
// WebSocket is blocked (it must fall back to SSE + POST and still answer). Screenshots of
// every step. Same prerequisites as live-smoke.mjs:
//   LIVE_SMOKE_WEB=http://localhost:3000 LIVE_SMOKE_OUT=/tmp/arena-ops node scripts/live-smoke-ops.mjs
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

const WEB = process.env.LIVE_SMOKE_WEB || "http://localhost:3000";
const OUT = process.env.LIVE_SMOKE_OUT || "live-smoke-ops-shots";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await chromium.launch({ executablePath: process.env.LIVE_SMOKE_CHROMIUM || undefined, args: ["--no-sandbox"] });
const errors = [];
const checks = [];
const check = (name, ok) => { checks.push({ name, ok: Boolean(ok) }); log(ok ? "OK  " : "FAIL", name); };

async function api(ctx, method, path, body) {
  const res = await ctx.request.fetch(`${WEB}${path}`, { method, data: body, headers: { "content-type": "application/json" } });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${text}`);
  return text ? JSON.parse(text) : null;
}

function watch(page, who, { allowWsErrors = false } = {}) {
  page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() !== "error" || text.startsWith("Failed to load resource")) return;
    if (allowWsErrors && /WebSocket/i.test(text)) return; // the blocked socket is the point of the test
    errors.push(`${who} console: ${text}`);
  });
  page.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/favicon.ico") && errors.push(`${who} HTTP ${r.status()} ${r.url()}`));
}

// ---------------------------------------------------------------- host + quiz
const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "pt-BR" });
const email = `ops-${Date.now()}@example.com`;
await api(hostCtx, "POST", "/api/auth/register", { email, password: "correct-horse-battery", display_name: "Instrutora" }).catch(() => null);
await api(hostCtx, "POST", "/api/auth/login", { email, password: "correct-horse-battery" });
let quiz = await api(hostCtx, "POST", "/api/live/quizzes", {
  title: "Ensaio — Resposta a incidentes", theme_key: "neon_soc", settings: { reading_phase_s: 2, leaderboard_every: 0 },
});
for (const item of [
  { item_type: "single_choice", prompt: "Qual é a primeira fase da resposta a incidentes (NIST)?", options: [{ text: "Preparação", correct: true }, { text: "Erradicação" }, { text: "Lições aprendidas" }, { text: "Contenção" }], time_limit_s: 40 },
  { item_type: "single_choice", prompt: "Qual evidência é mais volátil?", options: [{ text: "Memória RAM", correct: true }, { text: "Disco" }, { text: "Backup em fita" }], time_limit_s: 30 },
]) quiz = await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/items`, { expected_version: quiz.version, ...item });
await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/publish`, { expected_version: quiz.version });

const host = await hostCtx.newPage();
watch(host, "host");
await host.goto(`${WEB}/quizzes/${quiz.id}/edit`);
await host.getByRole("button", { name: /^Apresentar$/ }).first().click();
await host.getByRole("checkbox", { name: /Ensaio/ }).check();
await host.getByLabel("Bots").fill("8");
await host.waitForTimeout(400);
await host.screenshot({ path: `${OUT}/31-dialogo-ensaio.png` });
await host.getByRole("button", { name: /Apresentar v|Abrir sala/ }).last().click();
await host.waitForURL(/\/present\//, { timeout: 15000 });
const sessionId = host.url().split("/present/")[1].split(/[?#/]/)[0];
const session = await api(hostCtx, "GET", `/api/live/sessions/${sessionId}`);
check("rehearsal session created from the dialog with 8 bots", session.rehearsal === true && session.participant_count === 8);
log("session", session.join_code);

// ---------------------------------------------------------------- phones
async function phone(name, { blockWebSocket = false } = {}) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
  if (blockWebSocket) {
    // A network that kills WebSockets (corporate proxy): the client must switch to SSE.
    await ctx.routeWebSocket(/\/api\/live\/ws/, (ws) => ws.close());
  }
  const page = await ctx.newPage();
  watch(page, name, { allowWsErrors: blockWebSocket });
  await page.goto(`${WEB}/j/${session.join_code}`);
  await page.getByRole("textbox", { name: "Seu nome" }).fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Entrar na sala" }).click();
  await page.getByRole("button", { name: /Anotei/ }).click({ timeout: 10000 });
  return page;
}
const ana = await phone("Ana");
const bia = await phone("Bia", { blockWebSocket: true });
await bia.waitForTimeout(6000);
check("blocked phone shows the alternative connection badge", await bia.getByText("Conexão alternativa").first().isVisible());
await bia.screenshot({ path: `${OUT}/32-celular-sse-lobby.png` });
await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}/33-telao-lobby-bots.png` });

// ---------------------------------------------------------------- extended time
await host.getByRole("button", { name: /Participantes \(/ }).click();
await host.getByLabel("Tempo de resposta de Ana").selectOption("2");
await host.waitForTimeout(800);
await host.screenshot({ path: `${OUT}/34-host-tempo-estendido.png` });
await host.getByRole("dialog").getByRole("button", { name: "Fechar" }).first().click();
// Focus returns to the drawer's trigger; drop it so Space drives the room, not that button.
await host.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await host.waitForTimeout(500);

// ---------------------------------------------------------------- question, pause, resume, extend
await host.keyboard.press("Space"); // start -> Q1
await host.waitForTimeout(3500);
check("participant sees her extended time badge", await ana.getByText(/Tempo estendido: 2×/).first().isVisible());
await ana.screenshot({ path: `${OUT}/35-celular-tempo-estendido.png` });
await host.keyboard.press("p");
await host.waitForTimeout(1200);
check("stage shows the paused state", await host.getByText("Pausado").first().isVisible());
check("phone shows the paused screen", await ana.getByText("O apresentador pausou").first().isVisible());
check("SSE phone also sees the pause", await bia.getByText("O apresentador pausou").first().isVisible());
await host.screenshot({ path: `${OUT}/36-telao-pausado.png` });
await ana.screenshot({ path: `${OUT}/37-celular-pausado.png` });
await host.waitForTimeout(1500);
await host.keyboard.press("p");
await host.waitForTimeout(800);
await host.keyboard.press("+");
await host.waitForTimeout(800);
check("resume reopens answers", !(await ana.getByText("O apresentador pausou").first().isVisible().catch(() => false)));

await bia.getByRole("button", { name: /Preparação/ }).first().click({ timeout: 8000 });
await bia.waitForTimeout(1500);
check("SSE phone answer acknowledged", await bia.getByText(/Resposta enviada|enviada/i).first().isVisible());
await bia.screenshot({ path: `${OUT}/38-celular-sse-respondeu.png` });
await ana.getByRole("button", { name: /Preparação/ }).first().click({ timeout: 8000 });
await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}/39-telao-respostas.png` });

// Bots answer over the question window; the host closes it.
await host.waitForTimeout(6000);
await host.keyboard.press("Space"); // lock / reveal
await host.waitForTimeout(1500);
await host.keyboard.press("Space");
await host.waitForTimeout(2500);
await host.screenshot({ path: `${OUT}/40-telao-reveal-ensaio.png` });
await bia.screenshot({ path: `${OUT}/41-celular-sse-reveal.png` });

// ---------------------------------------------------------------- report without bots
await api(hostCtx, "POST", `/api/live/sessions/${sessionId}/end`, {});
const report = await api(hostCtx, "GET", `/api/live/sessions/${sessionId}/report`);
check("report ignores bots (2 humans)", report.kpis.participants === 2);
const rehearsalEvents = await api(hostCtx, "GET", `/api/live/sessions/${sessionId}`);
check("session ended", rehearsalEvents.status === "finished");
const reportPage = await hostCtx.newPage();
watch(reportPage, "report");
await reportPage.goto(`${WEB}/quizzes/${quiz.id}/results/${sessionId}`);
await reportPage.waitForTimeout(3000);
check("report page shows the rehearsal badge", await reportPage.getByText("Ensaio").first().isVisible());
await reportPage.screenshot({ path: `${OUT}/42-relatorio-ensaio.png`, fullPage: true });

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ checks: checks.length, failed: failed.map((c) => c.name), errors }, null, 2));
process.exit(failed.length || errors.length ? 1 : 0);
