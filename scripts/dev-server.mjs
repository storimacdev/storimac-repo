#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Starts/stops the Next.js dev server (`web/`, `npm run dev`) as a
 * detached background process, so it survives the shell that launched it.
 * PID and log live under scripts/.run/ (gitignored).
 *
 * Readiness/URL detection probes TCP ports directly rather than scraping
 * the log: on Windows, `npm run dev` runs through nested cmd.exe layers
 * whose stdout buffering means Next's "Local: ..." banner may never reach
 * a redirected file, even though the server is genuinely up and serving.
 *
 * Usage: node scripts/dev-server.mjs <start|stop|restart|status>
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const WEB_DIR = path.join(REPO_ROOT, "web");
const RUN_DIR = path.join(__dirname, ".run");
const PID_FILE = path.join(RUN_DIR, "dev-server.pid");
const LOG_FILE = path.join(RUN_DIR, "dev-server.log");
const PORT_RANGE_START = 3000;
const PORT_RANGE_END = 3010; // Next.js auto-increments off 3000 when it's taken.

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function checkPort(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** Returns the first bound port in range, or null if none is listening yet. */
async function findBoundPort() {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (await checkPort(port)) return port;
  }
  return null;
}

async function start() {
  const existing = readPid();
  if (existing && isAlive(existing)) {
    console.log(`Dev server already running (PID ${existing}).`);
    const port = await findBoundPort();
    if (port) console.log(`URL: http://localhost:${port}`);
    return;
  }

  fs.mkdirSync(RUN_DIR, { recursive: true });
  const log = fs.openSync(LOG_FILE, "w");

  // Windows can't spawn a .cmd directly with detached:true (EINVAL), and
  // shell:true with an args array triggers Node's unescaped-args warning —
  // routing through cmd.exe /c as an explicit executable avoids both.
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/c", "npm", "run", "dev"], { cwd: WEB_DIR, detached: true, stdio: ["ignore", log, log] })
      : spawn("npm", ["run", "dev"], { cwd: WEB_DIR, detached: true, stdio: ["ignore", log, log] });
  child.unref();
  fs.closeSync(log);

  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`Started Next.js dev server (PID ${child.pid}).`);
  console.log(`Log: ${LOG_FILE}`);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const port = await findBoundPort();
    if (port) {
      console.log(`Ready at http://localhost:${port}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("Still starting (or failed) — check the log for details:", LOG_FILE);
}

function stop() {
  const pid = readPid();
  if (!pid || !isAlive(pid)) {
    console.log("No dev server is running.");
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    return;
  }

  console.log(`Stopping dev server (PID ${pid})...`);
  if (process.platform === "win32") {
    // npm spawns next as a child process; /t kills the whole tree.
    execSync(`taskkill /pid ${pid} /t /f`, { stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGTERM"); // detached => pid is also the process group id
    } catch {
      process.kill(pid, "SIGTERM");
    }
  }
  fs.unlinkSync(PID_FILE);
  console.log("Stopped.");
}

async function status() {
  const pid = readPid();
  if (!pid || !isAlive(pid)) {
    console.log("Dev server is not running.");
    return;
  }
  console.log(`Dev server is running (PID ${pid}).`);
  const port = await findBoundPort();
  if (port) console.log(`URL: http://localhost:${port}`);
}

const cmd = process.argv[2];
switch (cmd) {
  case "start":
    await start();
    break;
  case "stop":
    stop();
    break;
  case "restart":
    stop();
    await new Promise((r) => setTimeout(r, 1000));
    await start();
    break;
  case "status":
    await status();
    break;
  default:
    console.log("Usage: node scripts/dev-server.mjs <start|stop|restart|status>");
    process.exit(1);
}
