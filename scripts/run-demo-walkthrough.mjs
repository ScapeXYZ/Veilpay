#!/usr/bin/env node
/**
 * Runs the live UI walkthrough in a newly-created temporary SQLite database.
 * Only loopback ports are used; the temporary directory is removed afterwards.
 */
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = listener.address();
      if (!address || typeof address === "string") return reject(new Error("Could not reserve a loopback port"));
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const tmp = await mkdtemp(path.join(os.tmpdir(), "veilpay-demo-"));
let playwrightPid;
try {
  const [frontendPort, backendPort] = await Promise.all([freeLoopbackPort(), freeLoopbackPort()]);
  const env = {
    ...process.env,
    VEILPAY_DEMO_FRONTEND_PORT: String(frontendPort),
    VEILPAY_DEMO_BACKEND_PORT: String(backendPort),
    VEILPAY_DEMO_DATABASE: path.join(tmp, "regtest-mock.sqlite"),
  };
  console.log(`Running live Axum/Next walkthrough on loopback ports ${frontendPort}/${backendPort}.`);
  const fullSuite = process.argv.includes("--full");
  const args = fullSuite
    ? ["playwright", "test"]
    : ["playwright", "test", "--project=chromium-desktop", "-g", "deterministic hackathon walkthrough"];
  const child = spawn("npx", args, {
    cwd: process.cwd(), env, stdio: "inherit", detached: true,
  });
  playwrightPid = child.pid;
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = status;
} finally {
  // Playwright normally stops webServer children. Kill this runner's separate
  // process group as a backstop after failures so a stale dev server cannot
  // retain a port or the disposable SQLite file.
  if (playwrightPid) {
    try { process.kill(-playwrightPid, "SIGTERM"); } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  await rm(tmp, { recursive: true, force: true });
}
