// Sentinel Arena AI authoring real-browser smoke test (Incremento 2).
// Needs the API with LIVE_ENABLED=true, LIVE_HOST_POLICY=all, AI_AUTHORING_ENABLED=true,
// REGISTRATION_EMAIL_VERIFICATION=false (AI_PROVIDER=fake gives deterministic output) and the web app.
//   AI_SMOKE_OUT=/tmp/ai-shots node scripts/ai-smoke.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const WEB = process.env.AI_SMOKE_WEB || "http://localhost:3000";
const OUT = process.env.AI_SMOKE_OUT || "ai-smoke-shots";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.AI_SMOKE_CHROMIUM || undefined, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const api = async (method, path, body) => {
  const res = await ctx.request.fetch(`${WEB}${path}`, { method, data: body });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${text}`);
  return text ? JSON.parse(text) : null;
};
const email = `ai-${Date.now()}@example.com`;
await api("POST", "/api/auth/register", { email, password: "correct-horse-battery" }).catch(() => null);
await api("POST", "/api/auth/login", { email, password: "correct-horse-battery" });
const quiz = await api("POST", "/api/live/quizzes", { title: "Treinamento de phishing (IA)" });

const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
page.on("response", (r) => r.status() >= 500 && errors.push(`HTTP ${r.status()} ${r.url()}`));
await page.goto(`${WEB}/quizzes/${quiz.id}/edit`);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/01-editor-vazio.png` });

await page.getByRole("button", { name: "Gerar com IA" }).first().click();
await page.waitForTimeout(800);
await page.getByLabel("Tema ou objetivo").fill("Phishing, autenticação e resposta a incidentes para a equipe comercial");
await page.screenshot({ path: `${OUT}/02-dialogo-tema.png` });
await page.getByRole("button", { name: /^Gerar \d+ perguntas$/ }).click();
log("generation submitted");
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/03-progresso.png` });
await page.getByRole("button", { name: "Selecionar todos os válidos" }).waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/04-rascunhos.png` });
await page.screenshot({ path: `${OUT}/04b-rascunhos-full.png`, fullPage: true });
await page.getByRole("button", { name: "Selecionar todos os válidos" }).click();
await page.getByRole("button", { name: /^Adicionar \d+ ao quiz$/ }).click();
await page.waitForTimeout(1500);
log("drafts applied");
await page.keyboard.press("Escape");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/05-editor-com-ia.png` });

let detail = await api("GET", `/api/live/quizzes/${quiz.id}`);
log("items", detail.items.map((i) => `${i.item_type}:${i.review_state}:${i.ai?.requires_key_confirmation}`).join(" "));
const flagged = detail.items.find((i) => i.ai?.requires_key_confirmation);
if (flagged) {
  await page.getByText(flagged.prompt.slice(0, 30)).first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/06-item-sinalizado.png` });
  await page.getByLabel("Conferi o gabarito desta questão").check();
  await page.getByRole("button", { name: "Marcar como revisada" }).click();
  await page.waitForTimeout(1200);
  log("flagged item reviewed with key confirmation");
}
const first = detail.items.find((i) => i.item_type === "single_choice" && i.id !== flagged?.id) || detail.items[0];
await page.getByText(first.prompt.slice(0, 30)).first().click();
await page.waitForTimeout(800);
await page.getByText("Melhorar com IA").first().click();
await page.waitForTimeout(500);
await page.getByRole("radio", { name: /Escrever explicação/ }).check();
await page.getByRole("button", { name: "Escrever explicação" }).click();
await page.getByRole("button", { name: "Aplicar" }).waitFor({ timeout: 20000 });
await page.screenshot({ path: `${OUT}/07-melhorar-com-ia.png` });
await page.getByRole("button", { name: "Aplicar" }).click();
await page.waitForTimeout(1500);
log("improvement applied");

detail = await api("GET", `/api/live/quizzes/${quiz.id}`);
for (const item of detail.items.filter((i) => i.review_state === "needs_review")) {
  detail = await api("POST", `/api/live/quizzes/${quiz.id}/items/${item.id}/review`, { expected_version: detail.version, confirm_key: true });
}
const published = await api("POST", `/api/live/quizzes/${quiz.id}/publish`, { expected_version: detail.version });
log("published v", published.version_no, "items", published.quiz.items.length);
const caps = await api("GET", "/api/ai/capabilities");
log("credits", JSON.stringify(caps.credits));
log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exitCode = 1;
