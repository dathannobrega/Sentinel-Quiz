// Sentinel Arena real-browser smoke test of the GA item types (Incremento 5): a word cloud
// (with the host hiding a word), an ordering item (reordered with the accessible up/down
// buttons), a numeric item (pt-BR input), the editor with a PBQ imported from the bank,
// the report and the phone's final results. Screenshots of every screen.
//
// Needs the API (LIVE_ENABLED=true, LIVE_HOST_POLICY=all, REGISTRATION_EMAIL_VERIFICATION=false,
// the Security+ PBQs ingested) and the web app running. Run from web/:
//   LIVE_SMOKE_WEB=http://localhost:3000 LIVE_SMOKE_OUT=/tmp/arena-shots node scripts/live-smoke-ga.mjs
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
  page.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/favicon.ico") && errors.push(`${who} HTTP ${r.status()} ${r.url()}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(`${who} console: ${m.text()}`));
}

async function api(ctx, method, path, body) {
  const res = await ctx.request.fetch(`${WEB}${path}`, { method, data: body, headers: { "content-type": "application/json" } });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${text}`);
  return text ? JSON.parse(text) : null;
}

const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "pt-BR" });
const email = `ga-${Date.now()}@example.com`;
await api(hostCtx, "POST", "/api/auth/register", { email, password: "correct-horse-battery", display_name: "Instrutora" }).catch(() => null);
await api(hostCtx, "POST", "/api/auth/login", { email, password: "correct-horse-battery" });

const ORDER = ["Preparação", "Detecção e análise", "Contenção", "Erradicação", "Recuperação"];
let quiz = await api(hostCtx, "POST", "/api/live/quizzes", {
  title: "Resposta a incidentes — tipos novos", theme_key: "aurora", settings: { reading_phase_s: 0, leaderboard_every: 0 },
});
for (const item of [
  { item_type: "word_cloud", prompt: "Uma palavra que resume segurança para você", max_words: 2, time_limit_s: 60 },
  { item_type: "ordering", prompt: "Ordene as fases de resposta a incidentes (NIST)", options: ORDER.map((text) => ({ text })), time_limit_s: 60 },
  { item_type: "numeric", prompt: "Quantos bits tem a chave do AES-256?", min: 0, max: 1000, step: 1, unit: "bits", value: 256, tolerance: 10, time_limit_s: 60 },
]) quiz = await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/items`, { expected_version: quiz.version, ...item });

// A PBQ ordering task from the bank (the Security+ volatility task).
const bank = await api(hostCtx, "GET", "/api/live/bank/search?limit=50&q=sq_pbq");
const pbq = bank.items.find((i) => i.convertible_to === "ordering");
check("bank lists a convertible PBQ", Boolean(pbq), pbq ? pbq.question_id : `${bank.total} pbq results`);
if (pbq) {
  const imported = await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/items/from-bank`, { expected_version: quiz.version, question_ids: [pbq.question_id] });
  quiz = imported.quiz;
  const item = quiz.items.at(-1);
  check("PBQ imported as ordering", item.item_type === "ordering" && item.options.length === 6, item.prompt.slice(0, 60));
}

const editor = await hostCtx.newPage();
watch(editor, "editor");
await editor.goto(`${WEB}/quizzes/${quiz.id}/edit`); await editor.waitForTimeout(3500);
await editor.screenshot({ path: `${OUT}/53-editor-nuvem.png` });
for (const [index, shot] of [[1, "54-editor-ordenar"], [2, "55-editor-numerica"], [3, "56-editor-pbq-banco"]]) {
  await editor.getByRole("button", { name: new RegExp(quiz.items[index].prompt.slice(0, 20).replace(/[()]/g, ".")) }).first().click();
  await editor.waitForTimeout(1200);
  await editor.screenshot({ path: `${OUT}/${shot}.png` });
}
await editor.close();
// The PBQ stays in the quiz only for the editor screenshots: this session plays the first three.
quiz = await api(hostCtx, "DELETE", `/api/live/quizzes/${quiz.id}/items/${quiz.items[3].id}?expected_version=${quiz.version}`);
const pub = await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/publish`, { expected_version: quiz.version });
log("published v", pub.version_no, "items", pub.quiz.items.length);

const session = await api(hostCtx, "POST", "/api/live/sessions", { quiz_id: quiz.id, preset: "turma" });
const host = await hostCtx.newPage();
watch(host, "host");
await host.goto(`${WEB}/present/${session.id}`); await host.waitForTimeout(3000);
const presenter = await hostCtx.newPage();
watch(presenter, "presenter");
await presenter.goto(`${WEB}/present/${session.id}?view=presenter`); await presenter.waitForTimeout(3000);

const phones = [];
for (const name of ["Ana", "Bruno", "Carla"]) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
  const page = await ctx.newPage();
  watch(page, name);
  await page.goto(`${WEB}/j/${session.join_code}`);
  await page.getByRole("textbox", { name: "Seu nome" }).fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Entrar na sala" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Anotei/ }).click();
  await page.waitForTimeout(600);
  phones.push({ name, page });
}
async function hostAction(label, wait = 1500) {
  await host.bringToFront();
  await host.keyboard.press("Space");
  await host.waitForTimeout(wait);
  log("host:", label);
}

// 1. Word cloud: live on the projector, the host hides a word from the presenter view.
await hostAction("start -> word cloud", 2500);
await phones[0].page.screenshot({ path: `${OUT}/57-celular-nuvem.png` });
const words = [["Zero Trust", "MFA"], ["MFA", "Backup"], ["zero trust", "Senha123"]];
for (const [i, pair] of words.entries()) {
  const inputs = phones[i].page.getByPlaceholder("Ex.: Zero Trust");
  await inputs.nth(0).fill(pair[0]);
  await inputs.nth(1).fill(pair[1]);
  await phones[i].page.getByRole("button", { name: /Enviar/ }).first().click();
}
await host.waitForTimeout(2500);
await host.screenshot({ path: `${OUT}/58-telao-nuvem-ao-vivo.png` });
const stageText = await host.locator("body").innerText();
check("projector shows the live cloud", /Zero Trust/i.test(stageText) && /MFA/.test(stageText));
await presenter.bringToFront();
await presenter.getByRole("button", { name: "Ocultar “Senha123” da nuvem" }).click();
await presenter.waitForTimeout(1500);
await presenter.screenshot({ path: `${OUT}/59-apresentador-ocultar-palavra.png` });
check("presenter lists the hidden word to show again", await presenter.getByRole("button", { name: /Mostrar “senha123” de novo/i }).count() === 1);
await host.bringToFront(); await host.waitForTimeout(800);
check("hidden word left the projector", !/Senha123/i.test(await host.locator("body").innerText()));
await hostAction("reveal cloud", 2500);
await host.screenshot({ path: `${OUT}/60-telao-nuvem-revelada.png` });

// 2. Ordering: Ana orders with the up/down buttons; Bruno swaps two; Carla sends as shown.
await hostAction("next -> ordering", 2500);
await phones[0].page.screenshot({ path: `${OUT}/61-celular-ordenar.png` });
async function positions(page) {
  const names = await page.getByRole("button", { name: /^Mover “/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.textContent || ""));
  const map = new Map();
  for (const label of names) {
    const m = label.match(/^Mover “(.+)” para (?:cima|baixo) \(posição (\d+)\)/);
    if (m) map.set(m[1], Number(m[2]));
  }
  return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([text]) => text);
}
async function arrange(page, target) {
  for (let i = 0; i < target.length; i += 1) {
    let current = await positions(page);
    while (current.indexOf(target[i]) > i) {
      const pos = current.indexOf(target[i]) + 1;
      await page.getByRole("button", { name: `Mover “${target[i]}” para cima (posição ${pos})` }).click();
      await page.waitForTimeout(150);
      current = await positions(page);
    }
  }
}
await arrange(phones[0].page, ORDER);
await phones[0].page.screenshot({ path: `${OUT}/62-celular-ordenado.png` });
check("phone reordered with buttons", JSON.stringify(await positions(phones[0].page)) === JSON.stringify(ORDER));
await arrange(phones[1].page, [ORDER[1], ORDER[0], ...ORDER.slice(2)]);
for (const phone of phones) await phone.page.getByRole("button", { name: "Enviar ordem" }).click();
await host.waitForTimeout(2000);
await hostAction("reveal ordering", 3000);
await host.screenshot({ path: `${OUT}/63-telao-ordem-revelada.png` });
await phones[0].page.screenshot({ path: `${OUT}/64-celular-ordem-acertou.png` });
await phones[1].page.screenshot({ path: `${OUT}/65-celular-ordem-parcial.png` });

// 3. Numeric: pt-BR input ("1.000" is one thousand).
await hostAction("next -> numeric", 2500);
for (const [i, value] of ["256", "1.000", "270"].entries()) {
  await phones[i].page.getByRole("textbox", { name: /Seu número/ }).fill(value);
  if (i === 0) await phones[0].page.screenshot({ path: `${OUT}/66-celular-numerica.png` });
  await phones[i].page.getByRole("button", { name: /^Enviar$/ }).click();
}
await host.waitForTimeout(2000);
await presenter.bringToFront(); await presenter.waitForTimeout(800);
await presenter.screenshot({ path: `${OUT}/67-apresentador-histograma.png` });
await hostAction("reveal numeric", 2500);
await host.screenshot({ path: `${OUT}/68-telao-numerica-revelada.png` });
await phones[2].page.screenshot({ path: `${OUT}/69-celular-numerica-parcial.png` });

await hostAction("next -> podium", 6000);
await hostAction("end", 2500);
await phones[1].page.screenshot({ path: `${OUT}/70-celular-resultados.png`, fullPage: true });

const report = await api(hostCtx, "GET", `/api/live/sessions/${session.id}/report`);
const [cloud, ordering, numeric] = report.items;
check("report word cloud marks the hidden word", cloud.word_cloud.words.some((w) => w.key === "senha123" && w.hidden), JSON.stringify(cloud.word_cloud.words.map((w) => `${w.key}:${w.n}`)));
check("report ordering has one exact order", ordering.ordering.exact === 1, JSON.stringify(ordering.ordering.slot_pct_correct));
check("report numeric read 1.000 as 1000", numeric.numeric.bins[19] === 1 && numeric.n_correct === 1, `mean ${numeric.numeric.mean}`);
log("scores", report.participants.map((p) => `${p.display_name}:${p.score}`).join(" "));
await host.goto(`${WEB}/quizzes/${quiz.id}/results/${session.id}`); await host.waitForTimeout(3500);
await host.screenshot({ path: `${OUT}/71-relatorio-tipos-novos.png`, fullPage: true });

console.log(checks.join("\n"));
log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exitCode = 1;
