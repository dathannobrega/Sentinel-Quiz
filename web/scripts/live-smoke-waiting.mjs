// Sentinel Arena real-browser smoke test of the waiting room (Incremento 7):
// the owner opens a room with "Aprovar a entrada" from the editor; two phones wait for approval,
// the presenter view approves one (the phone gets in on its own) and rejects the other; then the
// host turns approval off, lowers the cap, two more phones queue for a seat (one reloads and keeps
// its place) and get in when the host raises the cap. Screenshots of every screen.
//
// Needs the API (LIVE_ENABLED=true, LIVE_HOST_POLICY=all, REGISTRATION_EMAIL_VERIFICATION=false)
// and the web app. Run from web/:
//   LIVE_SMOKE_WEB=http://localhost:3000 LIVE_SMOKE_OUT=/tmp/arena-shots node scripts/live-smoke-waiting.mjs
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

const WEB = process.env.LIVE_SMOKE_WEB || "http://localhost:3000";
const OUT = process.env.LIVE_SMOKE_OUT || "live-smoke-shots";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await chromium.launch({ executablePath: process.env.LIVE_SMOKE_CHROMIUM || undefined, args: ["--no-sandbox"] });
const errors = [];
const checks = [];
function check(name, ok, detail = "") {
  checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) errors.push(`check failed: ${name} ${detail}`);
}
function watch(page, who) {
  page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  // Expected: 401 of /api/auth/me for a guest.
  const expected = (r) => r.status() === 401 && r.url().endsWith("/api/auth/me");
  page.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/favicon.ico") && !expected(r) && errors.push(`${who} HTTP ${r.status()} ${r.url()}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(`${who} console: ${m.text()}`));
}
async function api(ctx, method, path, body) {
  const res = await ctx.request.fetch(`${WEB}${path}`, { method, data: body, headers: { "content-type": "application/json" } });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${text}`);
  return text ? JSON.parse(text) : null;
}
/** Waits up to `ms` for `pattern` in the page's main text (the waiting phone polls every 3-4 s). */
async function waitText(page, pattern, ms = 12000) {
  const end = Date.now() + ms;
  let text = "";
  while (Date.now() < end) {
    text = await page.locator("main").innerText().catch(() => "");
    if (pattern.test(text)) return text;
    await page.waitForTimeout(400);
  }
  return text;
}

const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const email = `espera-${Date.now()}@example.com`;
await api(hostCtx, "POST", "/api/auth/register", { email, password: "correct-horse-battery", display_name: "Instrutora" }).catch(() => null);
await api(hostCtx, "POST", "/api/auth/login", { email, password: "correct-horse-battery" });
let quiz = await api(hostCtx, "POST", "/api/live/quizzes", { title: "Abertura do treinamento", theme_key: "sentinel" });
quiz = await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/items`, {
  expected_version: quiz.version,
  item_type: "single_choice",
  prompt: "Qual porta usa o HTTPS?",
  options: [{ text: "80" }, { text: "443", correct: true }],
  time_limit_s: 20
});
await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/publish`, { expected_version: quiz.version });

// 1. The owner opens the room with approval from the editor.
const host = await hostCtx.newPage();
watch(host, "host");
await host.goto(`${WEB}/quizzes/${quiz.id}/edit`); await host.waitForTimeout(3000);
await host.getByRole("button", { name: /^Apresentar/ }).first().click();
await host.waitForTimeout(800);
const dialog = host.locator("dialog[open]");
await dialog.getByText("Aprovar a entrada de cada pessoa (sala de espera)").click();
await host.waitForTimeout(300);
await host.screenshot({ path: `${OUT}/85-apresentar-com-aprovacao.png` });
await dialog.getByRole("button", { name: /Abrir sala|Apresentar v/ }).last().click();
await host.waitForURL(/\/present\//, { timeout: 15000 });
await host.waitForTimeout(3000);
const sessionId = host.url().split("/present/")[1].split(/[?#]/)[0];
const session = await api(hostCtx, "GET", `/api/live/sessions/${sessionId}`);
check("room created with approval", session.require_approval === true, session.join_code);

const presenter = await hostCtx.newPage();
watch(presenter, "presenter");
await presenter.goto(`${WEB}/present/${sessionId}?view=presenter`); await presenter.waitForTimeout(3000);

async function phone(name) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
  const page = await ctx.newPage();
  watch(page, name);
  await page.goto(`${WEB}/j/${session.join_code}`);
  await page.getByRole("textbox", { name: "Seu nome" }).fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Entrar na sala" }).click();
  await page.waitForTimeout(1500);
  return { name, page };
}

// 2. Two phones wait for approval.
const ana = await phone("Ana");
const bruno = await phone("Bruno");
const anaWait = await waitText(ana.page, /Aguardando o apresentador liberar a entrada/);
check("Ana waits for approval", /Aguardando o apresentador liberar a entrada/.test(anaWait) && /Sair da fila/.test(anaWait));
await ana.page.screenshot({ path: `${OUT}/86-celular-aguardando-aprovacao.png` });

await presenter.bringToFront();
await presenter.waitForTimeout(2000);
const panel = await presenter.locator("main").innerText();
check("presenter lists both people", /Ana/.test(panel) && /Bruno/.test(panel) && /Aprovar todos \(2\)/.test(panel));
await presenter.screenshot({ path: `${OUT}/87-apresentador-sala-de-espera.png` });

await host.bringToFront();
const stageButton = host.getByRole("button", { name: "Sala de espera: 2 aguardando" });
check("stage bar shows the waiting count", (await stageButton.count()) === 1);
await stageButton.click();
await host.waitForTimeout(800);
await host.screenshot({ path: `${OUT}/88-palco-dialogo-sala-de-espera.png` });
await host.keyboard.press("Escape");
await host.waitForTimeout(400);
check("the stage never shows waiting names", !/Bruno/.test(await host.locator("body").innerText()));

// 3. Approve Ana, reject Bruno.
await presenter.bringToFront();
await presenter.getByRole("button", { name: "Aprovar a entrada de Ana" }).click();
await presenter.getByRole("button", { name: "Recusar a entrada de Bruno" }).click();
const anaIn = await waitText(ana.page, /Anotei/);
check("Ana gets in on her own with the return code", /Anotei/.test(anaIn));
await ana.page.screenshot({ path: `${OUT}/89-celular-entrada-aprovada.png` });
await ana.page.getByRole("button", { name: /Anotei/ }).click();
const brunoOut = await waitText(bruno.page, /Entrada não liberada/);
check("Bruno sees the rejection", /Entrada não liberada/.test(brunoOut) && /Tentar de novo/.test(brunoOut));
await bruno.page.screenshot({ path: `${OUT}/90-celular-entrada-recusada.png` });

// 4. Approval off, cap 2: Carla enters, Davi and Eva queue for a seat.
await presenter.bringToFront();
await presenter.getByRole("switch", { name: /Aprovar a entrada/ }).first().click();
await presenter.waitForTimeout(800);
const capacity = presenter.getByLabel("Máximo de participantes").first();
await capacity.fill("2");
await presenter.getByRole("button", { name: "Salvar teto" }).first().click();
await presenter.waitForTimeout(1200);
const carla = await phone("Carla");
check("Carla enters directly", /Anotei/.test(await waitText(carla.page, /Anotei/, 5000)));
const davi = await phone("Davi");
const eva = await phone("Eva");
const daviWait = await waitText(davi.page, /Você é o próximo da fila/);
check("Davi is next in the full room's queue", /A sala está cheia/.test(daviWait) && /Você é o próximo da fila/.test(daviWait));
await davi.page.screenshot({ path: `${OUT}/91-celular-fila-lotacao.png` });
check("Eva is second", /Você é o nº 2 da fila/.test(await waitText(eva.page, /nº 2 da fila/)));
await eva.page.reload(); await eva.page.waitForTimeout(2500);
check("Eva keeps her place after a reload", /nº 2 da fila/.test(await waitText(eva.page, /nº 2 da fila/)));

await presenter.bringToFront();
await presenter.waitForTimeout(1500);
check("presenter counts the queue", /2 pessoas na fila/.test(await presenter.locator("main").innerText()));
await presenter.screenshot({ path: `${OUT}/92-apresentador-fila-lotacao.png` });

// 5. Raising the cap lets the queue in, in order.
await capacity.fill("4");
await presenter.getByRole("button", { name: "Salvar teto" }).first().click();
check("Davi gets in when the cap goes up", /Anotei/.test(await waitText(davi.page, /Anotei/, 15000)));
check("Eva gets in too", /Anotei/.test(await waitText(eva.page, /Anotei/, 15000)));
await eva.page.screenshot({ path: `${OUT}/93-celular-vaga-liberada.png` });
await presenter.waitForTimeout(1500);
const roomState = await api(hostCtx, "GET", `/api/live/sessions/${sessionId}`);
log("session", JSON.stringify({ count: roomState.participant_count, max: roomState.max_participants }));
await host.bringToFront(); await host.waitForTimeout(1200);
check("the lobby shows four people", /\b4\b/.test(await host.locator("body").innerText()));
await host.screenshot({ path: `${OUT}/94-palco-lobby-apos-fila.png` });

await browser.close();
console.log(checks.join("\n"));
log("errors:", errors.length ? errors.join("\n") : "none");
process.exit(errors.length ? 1 : 0);
