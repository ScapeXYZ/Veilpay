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
  async function runProject(project, grep, testFile) {
    const [frontendPort, backendPort] = await Promise.all([freeLoopbackPort(), freeLoopbackPort()]);
    const env = {
      ...process.env,
      VEILPAY_DEMO_FRONTEND_PORT: String(frontendPort),
      VEILPAY_DEMO_BACKEND_PORT: String(backendPort),
      VEILPAY_DEMO_DATABASE: path.join(tmp, `${project}.sqlite`),
    };
    console.log(`Running ${project} against live Axum/Next on loopback ports ${frontendPort}/${backendPort}.`);
    const args = ["playwright", "test", `--project=${project}`, "--workers=1"];
    if (grep) args.push("-g", grep);
    if (testFile) args.push(testFile);
    const child = spawn("npx", args, { cwd: process.cwd(), env, stdio: "inherit", detached: true });
    playwrightPid = child.pid;
    try {
      return await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
      });
    } finally {
      try { process.kill(-playwrightPid, "SIGTERM"); } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      playwrightPid = undefined;
    }
  }

  if (process.argv.includes("--full")) {
    // Browser contexts have separate cookies but the mock demo protects its shared
    // loopback backend with an IP rate limit. Give each stateful spec its own Axum
    // process and SQLite file, then repeat for each viewport project.
    for (const project of ["chromium-desktop", "chromium-mobile"]) {
      for (const testFile of ["tests/browser/corrections.spec.ts", "tests/browser/demo.spec.ts", "tests/browser/onboarding.spec.ts", "tests/browser/spending-chart.spec.ts"]) {
        const status = await runProject(project, undefined, testFile);
        if (status !== 0) {
          process.exitCode = status;
          break;
        }
      }
      if (process.exitCode) break;
    }
  } else {
    process.exitCode = await runProject("chromium-desktop", "deterministic hackathon walkthrough");
  }
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
