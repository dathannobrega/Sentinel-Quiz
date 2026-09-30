// Sentinel Arena Incremento 4 real-browser smoke test: flagged content from the editor, the
// admin "Arena" queue (approve, remove an item from an open room, overview), the pre-event
// check, participant report, "Meus dados", the claim to an account after the session, the
// deletion of a participant's data and the rehearsal phone preview. Screenshots of every step.
//
//   LIVE_SMOKE_WEB=http://localhost:3000 LIVE_SMOKE_OUT=/tmp/arena-mod \
//   LIVE_SMOKE_MAKE_ADMIN="psql ... -c \"UPDATE users SET role='admin' WHERE email='{email}'\"" \
//   node scripts/live-smoke-moderation.mjs
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

const WEB = process.env.LIVE_SMOKE_WEB || "http://localhost:3000";
const OUT = process.env.LIVE_SMOKE_OUT || "live-smoke-moderation-shots";
const MAKE_ADMIN = process.env.LIVE_SMOKE_MAKE_ADMIN || "";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await chromium.launch({ executablePath: process.env.LIVE_SMOKE_CHROMIUM || undefined, args: ["--no-sandbox"] });
const errors = [];
const checks = [];
const check = (name, ok) => { checks.push({ name, ok: Boolean(ok) }); log(ok ? "OK  " : "FAIL", name); };
const PASSWORD = "correct-horse-battery";

async function api(ctx, method, path, body) {
  const res = await ctx.request.fetch(`${WEB}${path}`, { method, data: body, headers: { "content-type": "application/json" } });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${text}`);
  return text ? JSON.parse(text) : null;
}
async function account(ctx, prefix, name) {
  const email = `${prefix}-${Date.now()}@example.com`;
  await api(ctx, "POST", "/api/auth/register", { email, password: PASSWORD, display_name: name }).catch(() => null);
  await api(ctx, "POST", "/api/auth/login", { email, password: PASSWORD });
  return email;
}
function watch(page, who, expected = []) {
  page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(`${who} console: ${m.text()}`));
  page.on("response", (r) => {
    const url = r.url();
    if (r.status() < 400 || url.endsWith("/favicon.ico") || expected.some((part) => url.includes(part))) return;
    errors.push(`${who} HTTP ${r.status()} ${url}`);
  });
}
const visible = (locator) => locator.first().isVisible().catch(() => false);

// ---------------------------------------------------------------- host publishes flagged content
const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "pt-BR" });
const hostEmail = await account(hostCtx, "mod-host", "Instrutora");
let quiz = await api(hostCtx, "POST", "/api/live/quizzes", { title: "Moderação — Engenharia social", theme_key: "sentinel", settings: { reading_phase_s: 0, leaderboard_every: 0 } });
for (const item of [
  { item_type: "single_choice", prompt: "Qual é o melhor sinal de phishing? Não seja um merda de desatento.", options: [{ text: "Remetente falsificado", correct: true }, { text: "Logo bonito" }], time_limit_s: 60 },
  { item_type: "single_choice", prompt: "O que fazer com um link suspeito?", options: [{ text: "Reportar ao SOC", correct: true }, { text: "Clicar para ver" }], time_limit_s: 60 },
]) quiz = await api(hostCtx, "POST", `/api/live/quizzes/${quiz.id}/items`, { expected_version: quiz.version, ...item });
const host = await hostCtx.newPage();
watch(host, "host", ["/api/live/sessions"]); // the 422 moderation_pending below is expected
await host.goto(`${WEB}/quizzes/${quiz.id}/edit`);
await host.getByRole("button", { name: /^Publicar$/ }).first().click();
await host.getByRole("button", { name: "Publicar agora" }).click();
await host.waitForTimeout(2000);
check("editor warns about flagged content after publishing", await visible(host.getByText("Conteúdo em revisão de moderação")));
await host.screenshot({ path: `${OUT}/51-editor-conteudo-sinalizado.png` });
await host.getByRole("button", { name: "Apresentar agora" }).click();
await host.getByRole("button", { name: /Apresentar v|Abrir sala/ }).last().click();
await host.waitForTimeout(1500);
check("start dialog explains the pending moderation", await visible(host.getByText("Conteúdo aguardando moderação")));
await host.screenshot({ path: `${OUT}/52-apresentar-aguardando-moderacao.png` });
await host.keyboard.press("Escape");

// ---------------------------------------------------------------- admin approves in the Arena queue
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const adminEmail = await account(adminCtx, "mod-admin", "Moderadora");
execSync(MAKE_ADMIN.replace("{email}", adminEmail), { stdio: "ignore" });
await api(adminCtx, "POST", "/api/auth/login", { email: adminEmail, password: PASSWORD });
const admin = await adminCtx.newPage();
watch(admin, "admin");
await admin.goto(`${WEB}/admin`);
await admin.getByRole("tab", { name: "Arena" }).or(admin.getByRole("button", { name: /^Arena$/ })).first().click();
await admin.waitForTimeout(800);
await admin.getByRole("tab", { name: "Moderação" }).or(admin.getByRole("button", { name: /^Moderação$/ })).first().click();
await admin.waitForTimeout(1500);
check("queue shows the filter case", await visible(admin.getByText(/merda de desatento/)));
await admin.screenshot({ path: `${OUT}/53-admin-fila-moderacao.png` });
const hostCase = () => admin.locator("div").filter({ hasText: hostEmail }).filter({ has: admin.getByRole("button", { name: "Descartar" }) }).last();
await hostCase().getByRole("button", { name: "Aprovar conteúdo" }).click();
await admin.waitForTimeout(800);
await admin.screenshot({ path: `${OUT}/53a-admin-confirmar.png` });
await admin.locator("dialog[open]").getByRole("button", { name: "Aprovar conteúdo" }).click();
await admin.waitForTimeout(1500);
await admin.screenshot({ path: `${OUT}/53b-admin-aprovado.png` });
check("approval removed the case from the open queue", !(await visible(admin.locator("div").filter({ hasText: hostEmail }).filter({ has: admin.getByRole("button", { name: "Descartar" }) }))));

// ---------------------------------------------------------------- host opens the room: preflight
const session = await api(hostCtx, "POST", "/api/live/sessions", { quiz_id: quiz.id });
check("guests allowed after approval", session.allow_guests === true);
await host.goto(`${WEB}/present/${session.id}`);
await host.waitForTimeout(2500);
await host.getByRole("button", { name: "Checagem pré-evento" }).first().click();
await host.waitForTimeout(2000);
check("pre-event check panel shows the checks", await visible(host.getByText(/Banco de dados|Database|database/i)));
await host.screenshot({ path: `${OUT}/54-checagem-pre-evento.png` });
await host.keyboard.press("Escape");
await host.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());

// ---------------------------------------------------------------- phones
async function phone(name) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
  const page = await ctx.newPage();
  watch(page, name, ["/api/live/me", "/api/live/rooms/"]); // a finished room is 404 on reload
  await page.goto(`${WEB}/j/${session.join_code}`);
  await page.getByRole("textbox", { name: "Seu nome" }).fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Entrar na sala" }).click();
  await page.getByRole("button", { name: /Anotei/ }).click({ timeout: 10000 });
  return { ctx, page };
}
const ana = await phone("Ana");
const bia = await phone("Bia");
await host.waitForTimeout(1200);
await host.keyboard.press("Space"); // Q1
await host.waitForTimeout(2500);

// Participant report of the current question.
await ana.page.getByRole("button", { name: "Mais opções" }).click();
await ana.page.getByRole("menuitem", { name: "Denunciar esta pergunta" }).or(ana.page.getByRole("button", { name: "Denunciar esta pergunta" })).first().click();
await ana.page.getByRole("radio", { name: /Ofensivo|ofensivo/ }).first().check();
await ana.page.getByRole("textbox").last().fill("Linguagem ofensiva no enunciado");
await ana.page.screenshot({ path: `${OUT}/55-celular-denunciar.png` });
await ana.page.getByRole("button", { name: "Enviar denúncia" }).click();
await ana.page.waitForTimeout(1500);

// Admin removes the reported item from the open room.
await admin.reload();
await admin.getByRole("tab", { name: "Arena" }).or(admin.getByRole("button", { name: /^Arena$/ })).first().click();
await admin.getByRole("tab", { name: "Moderação" }).or(admin.getByRole("button", { name: /^Moderação$/ })).first().click();
await admin.waitForTimeout(1500);
const reportCase = admin.locator("div").filter({ hasText: "Linguagem ofensiva no enunciado" }).filter({ has: admin.getByRole("button", { name: "Descartar" }) }).last();
await reportCase.getByRole("button", { name: "Remover item" }).click();
await admin.locator("dialog[open]").getByRole("textbox").first().fill("Linguagem ofensiva denunciada");
await admin.locator("dialog[open]").getByRole("button", { name: "Remover item" }).click();
await admin.waitForTimeout(2500);
check("phone shows the removed-content placeholder", await visible(bia.page.getByText("Conteúdo removido pela moderação")));
check("stage shows the removed-content placeholder", await visible(host.getByText("Conteúdo removido pela moderação")));
await bia.page.screenshot({ path: `${OUT}/56-celular-item-removido.png` });
await host.screenshot({ path: `${OUT}/57-telao-item-removido.png` });

// Admin overview while the room is open.
await admin.getByRole("tab", { name: "Visão geral" }).or(admin.getByRole("button", { name: /Visão geral|Salas ativas/ })).first().click().catch(() => null);
await admin.waitForTimeout(1500);
check("overview lists the open room", await visible(admin.getByText(session.join_code.slice(0, 3))));
await admin.screenshot({ path: `${OUT}/58-admin-visao-geral.png` });

// "Meus dados" during the session.
await bia.page.getByRole("button", { name: "Mais opções" }).click();
await bia.page.getByRole("menuitem", { name: "Meus dados" }).or(bia.page.getByRole("button", { name: "Meus dados" })).first().click();
await bia.page.waitForTimeout(1500);
check("my data panel shows the participation", await visible(bia.page.getByText("Excluir meus dados")));
await bia.page.screenshot({ path: `${OUT}/59-celular-meus-dados.png` });
await bia.page.getByRole("button", { name: "Excluir meus dados" }).last().click();
await bia.page.getByRole("button", { name: "Excluir definitivamente" }).click();
await bia.page.waitForTimeout(2000);
await bia.page.screenshot({ path: `${OUT}/60-celular-dados-excluidos.png` });

// ---------------------------------------------------------------- end + claim
await host.keyboard.press("Space"); // next -> Q2
await host.waitForTimeout(2000);
await ana.page.getByRole("button", { name: /Reportar ao SOC/ }).first().click({ timeout: 8000 });
await ana.page.waitForTimeout(1000);
await api(hostCtx, "POST", `/api/live/sessions/${session.id}/end`, {});
await ana.page.waitForTimeout(2500);
await account(ana.ctx, "mod-ana", "Ana Souza"); // Ana creates her account in the same browser
await ana.page.reload();
await ana.page.waitForTimeout(3000);
const claimButton = ana.page.getByRole("button", { name: "Salvar meu resultado na minha conta" });
check("final screen offers the claim", await visible(claimButton));
await ana.page.screenshot({ path: `${OUT}/61-celular-salvar-resultado.png` });
if (await visible(claimButton)) {
  await claimButton.first().click();
  await ana.page.waitForTimeout(2000);
  await ana.page.screenshot({ path: `${OUT}/62-celular-resultado-salvo.png` });
}
const report = await api(hostCtx, "GET", `/api/live/sessions/${session.id}/report`);
check("report ignores the erased participant", report.participants.every((p) => p.display_name !== "Bia"));

// ---------------------------------------------------------------- rehearsal preview
const rehearsal = await api(hostCtx, "POST", "/api/live/sessions", { quiz_id: quiz.id, rehearsal: true, bots: 5 });
await host.goto(`${WEB}/present/${rehearsal.id}`);
await host.waitForTimeout(2500);
await host.getByRole("button", { name: "Prévia do celular" }).first().click();
await host.waitForTimeout(3000);
check("phone preview renders the participant client", await visible(host.getByText("Prévia").first()));
await host.screenshot({ path: `${OUT}/63-ensaio-previa-celular.png` });

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ checks: checks.length, failed: failed.map((c) => c.name), errors }, null, 2));
process.exit(failed.length || errors.length ? 1 : 0);
