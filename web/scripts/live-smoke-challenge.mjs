// Sentinel Arena real-browser smoke test of the self-paced challenge (Incremento 6):
// the owner creates a challenge from the editor ("Criar desafio": ranking + correction
// after each item), two phones open /q/{slug}, join, play every item at their own pace
// (choice, multiple choice, typed answer, a content slide), see the per-item correction and
// the summary with their rank; the owner follows the panel, closes the challenge and opens
// the report; a scheduled challenge shows its countdown. Screenshots of every screen.
//
// Needs the API (LIVE_ENABLED=true, LIVE_HOST_POLICY=all, REGISTRATION_EMAIL_VERIFICATION=false)
// and the web app. Run from web/:
//   LIVE_SMOKE_WEB=http://localhost:3000 LIVE_SMOKE_OUT=/tmp/arena-shots node scripts/live-smoke-challenge.mjs
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
  // Expected answers, not errors: 404 of attempts/current before the first attempt ("not
  // started yet") and 401 of /api/auth/me for a guest (the claim card asks who is signed in).
  const expected = (r) => (r.status() === 404 && r.url().endsWith("/attempts/current")) || (r.status() === 401 && r.url().endsWith("/api/auth/me"));
  page.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/favicon.ico") && !expected(r) && errors.push(`${who} HTTP ${r.status()} ${r.url()}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(`${who} console: ${m.text()}`));
}
async function api(ctx, method, path, body) {
  const res = await ctx.request.fetch(`${WEB}${path}`, { method, data: body, headers: { "content-type": "application/json" } });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${text}`);
  return text ? JSON.parse(text) : null;
}

const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const email = `desafio-${Date.now()}@example.com`;
await api(hostCtx, "POST", "/api/auth/register", { email, password: "correct-horse-battery", display_name: "Instrutora" }).catch(() => null);
await api(hostCtx, "POST", "/api/auth/login", { email, password: "correct-horse-battery" });

let quiz = await api(hostCtx, "POST", "/api/live/quizzes", { title: "Desafio da semana: phishing", theme_key: "neon_soc" });
const ITEMS = [
  { item_type: "single_choice", prompt: "Qual controle mais reduz o risco de phishing?", options: [{ text: "Treinamento de conscientização", correct: true }, { text: "Relay SMTP aberto" }, { text: "Senha no post-it" }], time_limit_s: 30 },
  { item_type: "content", prompt: "Agora: autenticação", body: "As próximas perguntas são sobre fatores de autenticação." },
  { item_type: "multi_choice", prompt: "Quais são fatores de autenticação?", options: [{ text: "Senha", correct: true }, { text: "Token físico", correct: true }, { text: "Cor favorita" }], time_limit_s: 30 },
  { item_type: "type_answer", prompt: "Como se chama o phishing por SMS?", accepted_answers: ["smishing"], time_limit_s: 30 },
];
for (const item of ITEMS) quiz = await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/items`, { expected_version: quiz.version, ...item });
await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/publish`, { expected_version: quiz.version });

// 1. Owner creates the challenge from the editor.
const host = await hostCtx.newPage();
watch(host, "host");
await host.goto(`${WEB}/quizzes/${quiz.id}/edit`); await host.waitForTimeout(3000);
await host.getByRole("button", { name: /Criar desafio/ }).first().click();
await host.waitForTimeout(800);
const dialog = host.locator("dialog[open]");
await dialog.getByText("Mostrar ranking").first().click();
await dialog.getByText("A cada pergunta").first().click();
await host.waitForTimeout(300);
await host.screenshot({ path: `${OUT}/72-criar-desafio.png` });
await dialog.getByRole("button", { name: /^Criar desafio$/ }).click();
await host.waitForURL(/\/challenges\//, { timeout: 15000 });
await host.waitForTimeout(2500);
const sessionId = host.url().split("/challenges/")[1].split(/[?#]/)[0];
const created = await api(hostCtx, "GET", `/api/live/sessions/${sessionId}`);
const slug = created.challenge.slug;
check("challenge created from the editor", created.mode === "self_paced" && created.challenge.leaderboard && created.challenge.feedback === "each", slug);
await host.screenshot({ path: `${OUT}/73-painel-desafio-vazio.png` });

// 2. Two phones play at their own pace.
const answersFor = {
  Ana: { single: "Treinamento", multi: ["Senha", "Token"], typed: "Smishing" },
  Bruno: { single: "Relay", multi: ["Senha"], typed: "vishing" },
};
const phones = [];
for (const name of ["Ana", "Bruno"]) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
  const page = await ctx.newPage();
  watch(page, name);
  await page.goto(`${WEB}/q/${slug}`); await page.waitForTimeout(2000);
  if (name === "Ana") await page.screenshot({ path: `${OUT}/74-celular-desafio-entrada.png` });
  await page.getByRole("textbox", { name: "Seu nome" }).fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Entrar no desafio" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Anotei/ }).click();
  await page.waitForTimeout(1000);
  if (name === "Ana") await page.screenshot({ path: `${OUT}/75-celular-desafio-regras.png` });
  await page.getByRole("button", { name: /^Começar$/ }).click();
  await page.waitForTimeout(1500);
  phones.push({ name, page });
}

async function play(phone) {
  const { page, name } = phone;
  const plan = answersFor[name];
  for (let step = 0; step < 8; step += 1) {
    const text = await page.locator("main").innerText();
    if (/Tentativa concluída/.test(text)) return;
    if (/Agora: autenticação/.test(text) && (await page.getByRole("button", { name: /^Continuar$/ }).count())) {
      if (name === "Ana") await page.screenshot({ path: `${OUT}/77-celular-desafio-conteudo.png` });
      await page.getByRole("button", { name: /^Continuar$/ }).click();
    } else if (/Qual controle/.test(text)) {
      if (name === "Ana") await page.screenshot({ path: `${OUT}/76-celular-desafio-pergunta.png` });
      await page.getByRole("button", { name: new RegExp(plan.single) }).first().click();
    } else if (/fatores de autenticação\?/.test(text)) {
      for (const option of plan.multi) await page.getByRole("button", { name: new RegExp(option) }).first().click();
      await page.getByRole("button", { name: /Enviar/ }).first().click();
    } else if (/phishing por SMS/.test(text)) {
      const input = page.getByRole("textbox").first();
      await input.fill(plan.typed);
      await input.press("Enter");
    } else {
      await page.waitForTimeout(800);
      continue;
    }
    await page.waitForTimeout(1200);
    // Correction after each item, then "Próxima" (or "Ver resultado" after the last one).
    if (name === "Ana" && step === 0) await page.screenshot({ path: `${OUT}/78-celular-desafio-correcao.png` });
    const next = page.getByRole("button", { name: /^(Próxima|Ver resultado)$/ });
    if (await next.count()) { await next.first().click(); await page.waitForTimeout(1200); }
  }
}
for (const phone of phones) await play(phone);
await phones[0].page.waitForTimeout(1000);
const anaText = await phones[0].page.locator("main").innerText();
check("Ana finished first in the ranking", /Tentativa concluída/.test(anaText) && /1 de 2|1º/.test(anaText), anaText.slice(0, 120).replace(/\n/g, " | "));
await phones[0].page.screenshot({ path: `${OUT}/79-celular-desafio-resumo.png`, fullPage: true });
await phones[1].page.screenshot({ path: `${OUT}/80-celular-desafio-resumo-2.png`, fullPage: true });

// 3. Owner panel (polls every 10 s), close now, report.
await host.reload(); await host.waitForTimeout(3000);
const panelText = await host.locator("main").innerText();
check("panel shows two finishes", /Concluíram[\s\S]{0,40}2/.test(panelText) && /Ana/.test(panelText));
await host.screenshot({ path: `${OUT}/81-painel-desafio.png`, fullPage: true });
await host.getByRole("button", { name: "Fechar agora" }).first().click();
await host.waitForTimeout(500);
await host.locator("dialog[open]").getByRole("button", { name: "Fechar agora" }).click();
await host.waitForTimeout(2500);
const closed = await api(hostCtx, "GET", `/api/live/sessions/${sessionId}`);
check("owner closed the challenge", closed.challenge.state === "closed");
await phones[1].page.goto(`${WEB}/q/${slug}`); await phones[1].page.waitForTimeout(2500);
await phones[1].page.screenshot({ path: `${OUT}/82-celular-desafio-encerrado.png`, fullPage: true });
const report = await api(hostCtx, "GET", `/api/live/sessions/${sessionId}/report`);
check("report counts both finishers", report.kpis.participants === 2 && report.challenge.funnel.finished === 2, JSON.stringify(report.challenge.funnel));
await host.goto(`${WEB}/quizzes/${quiz.id}/results/${sessionId}`); await host.waitForTimeout(3500);
await host.screenshot({ path: `${OUT}/83-relatorio-desafio.png`, fullPage: true });

// 4. A scheduled challenge shows its countdown.
const later = await api(hostCtx, "POST", "/api/live/challenges", {
  quiz_id: quiz.id, opens_at: new Date(Date.now() + 3600e3).toISOString(), closes_at: new Date(Date.now() + 7 * 86400e3).toISOString(),
});
const visitor = await (await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" })).newPage();
watch(visitor, "visitor");
await visitor.goto(`${WEB}/q/${later.challenge.slug}`); await visitor.waitForTimeout(2500);
check("scheduled challenge shows the countdown", /Ainda não abriu/.test(await visitor.locator("main").innerText()));
await visitor.screenshot({ path: `${OUT}/84-celular-desafio-agendado.png` });

console.log(checks.join("\n"));
log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exitCode = 1;
