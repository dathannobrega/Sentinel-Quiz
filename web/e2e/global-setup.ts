import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./constants";

const WEB_DIR = path.resolve(__dirname, "..");
const REPO_DIR = path.resolve(WEB_DIR, "..");
const BACKEND_DIR = path.join(REPO_DIR, "backend");
const FIXTURE_QUESTIONS_DIR = path.join(__dirname, "fixtures", "questions");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url: string, label: string, child: ChildProcess, logFile: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited with code ${child.exitCode}.\n${tail(logFile)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} not ready at ${url} after ${timeoutMs}ms (${lastError}).\n${tail(logFile)}`);
}

function tail(file: string, lines = 60): string {
  try {
    return readFileSync(file, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function startLogged(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; logFile: string }) {
  const fd = openSync(options.logFile, "a");
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", fd, fd],
    // Own process group so teardown can stop the whole tree (next start spawns workers).
    detached: process.platform !== "win32"
  });
  closeSync(fd);
  return child;
}

function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || !child.pid) {
    return;
  }
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // Already gone.
  }
}

export default async function globalSetup() {
  const python = process.env.E2E_PYTHON || "python3";
  const tmp = mkdtempSync(path.join(tmpdir(), "sentinel-e2e-"));
  const backendPort = await freePort();
  const webPort = await freePort();
  const apiUrl = `http://127.0.0.1:${backendPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  const backendEnv: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: "development",
    DATABASE_URL: `sqlite:///${path.join(tmp, "e2e.db")}`,
    REGISTRATION_EMAIL_VERIFICATION: "false",
    BOOTSTRAP_SCHEMA: "true",
    INGEST_ON_STARTUP: "true",
    EXPOSE_API_DOCS: "true",
    QUESTION_JSON_DIR: FIXTURE_QUESTIONS_DIR,
    MATERIAL_DIR: path.join(REPO_DIR, "material"),
    CORS_ORIGINS: webUrl,
    PUBLIC_WEB_ORIGIN: webUrl,
    // http://127.0.0.1: the session cookie cannot be Secure (only honoured outside production).
    AUTH_COOKIE_SECURE: "false",
    // Every request comes from 127.0.0.1; the suite must not trip the per-IP limiter.
    RATE_LIMIT_ENABLED: "false",
    ABUSE_SIGNAL_ENABLED: "false",
    GEMINI_ENABLE: "false",
    GEMINI_API_KEY: "",
    SMTP_HOST: "",
    LOG_JSON: "false",
    LOG_LEVEL: "WARNING",
    PYTHONUNBUFFERED: "1"
  };

  const seed = spawnSync(python, [path.join(__dirname, "seed_admin.py"), BACKEND_DIR, ADMIN_EMAIL, ADMIN_PASSWORD], {
    cwd: BACKEND_DIR,
    env: backendEnv,
    encoding: "utf8"
  });
  if (seed.status !== 0) {
    throw new Error(
      `Admin seed failed (python: ${python}; set E2E_PYTHON to a python with backend deps).\n${seed.stdout}\n${seed.stderr}`
    );
  }

  const backendLog = path.join(tmp, "backend.log");
  const backend = startLogged(
    python,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort), "--no-access-log"],
    { cwd: BACKEND_DIR, env: backendEnv, logFile: backendLog }
  );

  let web: ChildProcess | undefined;
  const teardown = async () => {
    stop(web);
    stop(backend);
    if (!process.env.E2E_KEEP_TMP) {
      rmSync(tmp, { recursive: true, force: true });
    } else {
      console.log(`[e2e] kept temp dir ${tmp}`);
    }
  };

  try {
    await waitForHttp(`${apiUrl}/api/health`, "backend", backend, backendLog);

    const nextBin = path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next");
    const webEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      // Runtime API origin (injected per request into window.__SENTINEL_RUNTIME__ and the CSP).
      API_ORIGIN: apiUrl,
      BACKEND_ORIGIN: ""
    };
    if (!process.env.E2E_SKIP_BUILD || !existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) {
      const build = spawnSync(process.execPath, [nextBin, "build"], { cwd: WEB_DIR, env: webEnv, stdio: "inherit" });
      if (build.status !== 0) {
        throw new Error("next build failed");
      }
    }

    const webLog = path.join(tmp, "web.log");
    web = startLogged(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(webPort)], {
      cwd: WEB_DIR,
      env: webEnv,
      logFile: webLog
    });
    await waitForHttp(`${webUrl}/`, "web", web, webLog);
  } catch (error) {
    await teardown();
    throw error;
  }

  process.env.E2E_BASE_URL = webUrl;
  process.env.E2E_API_URL = apiUrl;
  console.log(`[e2e] backend ${apiUrl} · web ${webUrl} · tmp ${tmp}`);
  return teardown;
}
