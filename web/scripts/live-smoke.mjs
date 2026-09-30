// Sentinel Arena real-browser smoke test: a host (projector + presenter view) and three
// phones play a 6-item quiz end to end, taking screenshots of every screen.
//
// Needs the API (LIVE_ENABLED=true, LIVE_HOST_POLICY=all, REGISTRATION_EMAIL_VERIFICATION=false)
// and the web app running. Run from web/ (uses its Playwright):
//   LIVE_SMOKE_WEB=http://localhost:3000 LIVE_SMOKE_OUT=/tmp/arena-shots node scripts/live-smoke.mjs
// Optional: LIVE_SMOKE_CHROMIUM=/path/to/chromium (defaults to Playwright's own browser).
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

const WEB = process.env.LIVE_SMOKE_WEB || "http://localhost:3000";
const OUT = process.env.LIVE_SMOKE_OUT || "live-smoke-shots";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await chromium.launch({
  executablePath: process.env.LIVE_SMOKE_CHROMIUM || undefined,
  args: ["--no-sandbox"],
});
const errors = [];

async function api(ctx, method, path, body) {
  const res = await ctx.request.fetch(`${WEB}${path}`, { method, data: body, headers: { "content-type": "application/json" } });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${text}`);
  return text ? JSON.parse(text) : null;
}

const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "pt-BR" });
const email = `host-${Date.now()}@example.com`;
await api(hostCtx, "POST", "/api/auth/register", { email, password: "correct-horse-battery", display_name: "Instrutora" }).catch(() => null);
await api(hostCtx, "POST", "/api/auth/login", { email, password: "correct-horse-battery" });
log("host logged in");

let quiz = await api(hostCtx, "POST", "/api/live/quizzes", {
  title: "Security Awareness — Phishing", description: "Quiz ao vivo da turma", theme_key: "neon_soc",
  settings: { reading_phase_s: 3, leaderboard_every: 2 },
});
const items = [
  { item_type: "content", prompt: "Bem-vindos!", body: "Responda rápido: pontos por velocidade." },
  { item_type: "single_choice", prompt: "Qual controle mais reduz o risco de phishing?", options: [{ text: "Treinamento de conscientização", correct: true }, { text: "Relay SMTP aberto" }, { text: "Senha no post-it" }, { text: "Desativar MFA" }], time_limit_s: 20 },
  { item_type: "multi_choice", prompt: "Quais são fatores de autenticação?", options: [{ text: "Senha", correct: true }, { text: "Token físico", correct: true }, { text: "Cor favorita" }], time_limit_s: 25 },
  { item_type: "true_false", prompt: "HTTPS garante que o site é legítimo.", options: [{ key: "T", text: "Verdadeiro" }, { key: "F", text: "Falso", correct: true }], time_limit_s: 15 },
  { item_type: "type_answer", prompt: "Como se chama o phishing por SMS?", accepted_answers: ["smishing"], time_limit_s: 20 },
  { item_type: "poll", prompt: "Sua empresa usa MFA em todos os sistemas?", options: [{ text: "Sim" }, { text: "Parcialmente" }, { text: "Não" }], time_limit_s: 20 },
];
for (const item of items) quiz = await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/items`, { expected_version: quiz.version, ...item });
const pub = await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/publish`, { expected_version: quiz.version });
log("published v", pub.version_no, "warnings", pub.warnings.length);

const host = await hostCtx.newPage();
host.on("pageerror", (e) => errors.push(`host: ${e.message}`));
host.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/favicon.ico") && errors.push(`host HTTP ${r.status()} ${r.url()}`));
// Failed resources are reported (with their URL) by the response listener below.
host.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(`host console: ${m.text()}`));
await host.goto(`${WEB}/quizzes`); await host.waitForTimeout(2500);
await host.screenshot({ path: `${OUT}/01-biblioteca.png` });
await host.goto(`${WEB}/quizzes/${quiz.id}/edit`); await host.waitForTimeout(3000);
await host.screenshot({ path: `${OUT}/02-editor.png` });

const session = await api(hostCtx, "POST", "/api/live/sessions", { quiz_id: quiz.id, preset: "evento" });
log("session", session.join_code);
await host.goto(`${WEB}/present/${session.id}`); await host.waitForTimeout(3000);

const phones = [];
for (const name of ["Ana", "Bruno", "Carla"]) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${WEB}/j/${session.join_code}`);
  await page.getByRole("textbox", { name: "Seu nome" }).fill(name);
  await page.getByRole("checkbox").check();
  if (name === "Ana") await page.screenshot({ path: `${OUT}/03-celular-entrada.png` });
  await page.getByRole("button", { name: "Entrar na sala" }).click();
  await page.waitForTimeout(1200);
  if (name === "Ana") await page.screenshot({ path: `${OUT}/03b-celular-codigo-retorno.png` });
  await page.getByRole("button", { name: /Anotei/ }).click();
  await page.waitForTimeout(800);
  phones.push({ name, page });
}
await phones[0].page.screenshot({ path: `${OUT}/04-celular-lobby.png` });
await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}/05-telao-lobby.png` });

async function hostAction(label) {
  await host.keyboard.press("Space");
  await host.waitForTimeout(900);
  log("host:", label);
}
async function tap(page, text) {
  const btn = page.getByRole("button", { name: new RegExp(text) }).first();
  await btn.click({ timeout: 8000 });
}

await hostAction("start (content)");
await host.screenshot({ path: `${OUT}/06-telao-conteudo.png` });
await hostAction("next -> Q1"); await host.waitForTimeout(3500);
await host.screenshot({ path: `${OUT}/07-telao-pergunta.png` });
await phones[0].page.screenshot({ path: `${OUT}/08-celular-pergunta.png` });
await tap(phones[0].page, "Treinamento");
await tap(phones[1].page, "Treinamento");
await tap(phones[2].page, "Relay");
await host.waitForTimeout(1500);
await phones[0].page.screenshot({ path: `${OUT}/09-celular-enviado.png` });
await hostAction("reveal"); await host.waitForTimeout(2000);
await host.screenshot({ path: `${OUT}/10-telao-reveal.png` });
await phones[0].page.screenshot({ path: `${OUT}/11-celular-acertou.png` });
await phones[2].page.screenshot({ path: `${OUT}/12-celular-errou.png` });

await hostAction("next -> Q2"); await host.waitForTimeout(3500);
for (const [i, picks] of [["Senha", "Token"], ["Senha"], ["Cor"]].entries()) {
  for (const p of picks) await tap(phones[i].page, p);
  await tap(phones[i].page, "Enviar");
}
await host.waitForTimeout(1500);
await hostAction("reveal"); await host.waitForTimeout(1500);
await hostAction("leaderboard"); await host.waitForTimeout(2500);
await host.screenshot({ path: `${OUT}/13-telao-ranking.png` });
await phones[1].page.screenshot({ path: `${OUT}/14-celular-ranking.png` });

await hostAction("next -> Q3"); await host.waitForTimeout(3500);
await tap(phones[0].page, "Falso"); await tap(phones[1].page, "Verdadeiro"); await tap(phones[2].page, "Falso");
await host.waitForTimeout(1500);
await hostAction("reveal"); await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}/15-telao-vf.png` });

await hostAction("next -> Q4"); await host.waitForTimeout(3500);
for (const [i, text] of ["Smishing", "sms phishing", "vishing"].entries()) {
  const input = phones[i].page.getByRole("textbox").first();
  await input.fill(text);
  await input.press("Enter");
}
await host.waitForTimeout(1500);
await hostAction("reveal"); await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}/16-telao-digitada.png` });

await hostAction("auto leaderboard (every 2)"); await host.waitForTimeout(1500);
await hostAction("next -> Q5 poll"); await host.waitForTimeout(3500);
const presenter = await hostCtx.newPage();
await presenter.goto(`${WEB}/present/${session.id}?view=presenter`); await presenter.waitForTimeout(3000);
await presenter.screenshot({ path: `${OUT}/16b-visao-apresentador.png` });
await presenter.close();
for (const [i, text] of ["Sim", "Parcialmente", "Sim"].entries()) await tap(phones[i].page, text);
await host.waitForTimeout(1500);
await hostAction("reveal"); await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}/17-telao-enquete.png` });

await hostAction("next -> podium"); await host.waitForTimeout(7000);
await host.screenshot({ path: `${OUT}/18-telao-podio.png` });
await phones[0].page.screenshot({ path: `${OUT}/19-celular-final.png` });
await hostAction("end"); await host.waitForTimeout(2000);

const report = await api(hostCtx, "GET", `/api/live/sessions/${session.id}/report`);
log("report kpis", JSON.stringify(report.kpis), "participants", report.participants.map((p) => `${p.display_name}:${p.score}`).join(" "));
await host.goto(`${WEB}/quizzes/${quiz.id}/results/${session.id}`); await host.waitForTimeout(3500);
await host.screenshot({ path: `${OUT}/20-relatorio.png`, fullPage: true });
log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exitCode = 1;
