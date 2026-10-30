import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadCredentialEnvironment, validateCredentialValue } from "../config/credentials.js";
import { resolveArkSpacePaths } from "../config/paths.js";
import { UseGptConfigSchema } from "../config/schema.js";
import { loadConfig } from "../config/store.js";
import { daemonStatus, defaultDaemonDataDir } from "./daemon.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function configuredUseGptDataDir(environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  return (await loadConfig(resolveArkSpacePaths(environment).config)).connections?.usegpt?.dataDir ?? defaultDaemonDataDir();
}

export async function diagnoseUseGpt(environment: NodeJS.ProcessEnv = process.env) {
  const paths = resolveArkSpacePaths(environment);
  let configured = false;
  let dataDir = defaultDaemonDataDir();
  const issues: string[] = [];
  try {
    const parsed = UseGptConfigSchema.safeParse((await loadConfig(paths.config)).connections?.usegpt);
    if (parsed.success && parsed.data.dataDir) dataDir = parsed.data.dataDir;
    const effective = await loadCredentialEnvironment(paths.credentials, environment);
    configured = Boolean(parsed.success && parsed.data.enabled && parsed.data.tunnelId && parsed.data.apiKeyRef === "env:CONTROL_PLANE_API_KEY" && validateCredentialValue(effective.CONTROL_PLANE_API_KEY ?? ""));
    if (!configured) issues.push("configuration_incomplete");
  } catch { issues.push("configuration_unreadable"); }
  let daemonRunning = false;
  try { daemonRunning = (await daemonStatus(dataDir)).running; }
  catch { issues.push("hub_unavailable"); }
  let tunnelRunning = false;
  try {
    const state: unknown = JSON.parse(await readFile(join(dataDir, ".tunnel", "tunnel.json"), "utf8"));
    if (typeof state === "object" && state !== null && "pid" in state && typeof state.pid === "number" && Number.isSafeInteger(state.pid) && state.pid > 1) {
      process.kill(state.pid, 0); tunnelRunning = true;
    }
  } catch { /* Missing state or an exited process means the local Tunnel is stopped. */ }
  if (!daemonRunning) issues.push("hub_stopped");
  if (!tunnelRunning) issues.push("tunnel_stopped");
  return { ok: configured && daemonRunning && tunnelRunning, configured, configFile: paths.config, dataDir, daemonRunning, tunnelRunning, issues,
    next: configured ? "arks setup usegpt --start" : "arks setup usegpt", evidence: "Local configuration and processes only; verify ChatGPT connectivity by publishing a test artifact." };
}

/** Starts only missing services using the installed entry; opening setup alone never starts network activity. */
export async function startUseGptService(service: "daemon" | "tunnel", environment: NodeJS.ProcessEnv = process.env) {
  const before = await diagnoseUseGpt(environment);
  if (!before.configured) throw new Error("UseGPT configuration is incomplete. Run arks setup usegpt first.");
  const entry = process.argv[1];
  if (!entry) throw new Error("Cannot locate the arks entry point.");
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, [resolve(entry), "usegpt", service, "start", "--data-dir", before.dataDir], { stdio: ["ignore", "pipe", "pipe"], env: environment, shell: false });
    child.stdout.resume(); child.stderr.resume(); child.once("error", () => reject(new Error(`UseGPT ${service} could not start.`)));
    child.once("close", code => code === 0 ? done() : reject(new Error(`UseGPT ${service} could not start.`)));
  });
  return diagnoseUseGpt(environment);
}

export async function stopUseGptService(service: "daemon" | "tunnel", environment: NodeJS.ProcessEnv = process.env) {
  const before = await diagnoseUseGpt(environment);
  const entry = process.argv[1];
  if (!entry) throw new Error("Cannot locate the arks entry point.");
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, [resolve(entry), "usegpt", service, "stop", "--data-dir", before.dataDir], { stdio: ["ignore", "pipe", "pipe"], env: environment, shell: false });
    child.stdout.resume(); child.stderr.resume(); child.once("error", () => reject(new Error(`UseGPT ${service} could not stop.`)));
    child.once("close", code => code === 0 ? done() : reject(new Error(`UseGPT ${service} could not stop.`)));
  });
  return diagnoseUseGpt(environment);
}

export async function startUseGptServices(environment: NodeJS.ProcessEnv = process.env) {
  const before = await diagnoseUseGpt(environment);
  if (!before.configured) throw new Error("UseGPT configuration is incomplete. Run arks setup usegpt first.");
  const entry = process.argv[1];
  if (!entry) throw new Error("Cannot locate the arks entry point.");
  for (const service of ["daemon", "tunnel"]) {
    await new Promise<void>((done, reject) => {
      const child = spawn(process.execPath, [resolve(entry), "usegpt", service, "start", "--data-dir", before.dataDir], { stdio: ["ignore", "pipe", "pipe"], env: environment, shell: false });
      child.stdout.resume(); child.stderr.resume();
      child.once("error", () => reject(new Error(`UseGPT ${service} could not start.`)));
      child.once("close", code => code === 0 ? done() : reject(new Error(`UseGPT ${service} could not start. Run arks usegpt diagnose --json.`)));
    });
  }
  return diagnoseUseGpt(environment);
}

export async function stopUseGptServices(environment: NodeJS.ProcessEnv = process.env) {
  const before = await diagnoseUseGpt(environment);
  const entry = process.argv[1];
  if (!entry) throw new Error("Cannot locate the arks entry point.");
  for (const service of ["tunnel", "daemon"]) {
    await new Promise<void>((done, reject) => {
      const child = spawn(process.execPath, [resolve(entry), "usegpt", service, "stop", "--data-dir", before.dataDir], { stdio: ["ignore", "pipe", "pipe"], env: environment, shell: false });
      child.stdout.resume(); child.stderr.resume();
      child.once("error", () => reject(new Error(`UseGPT ${service} could not stop.`)));
      child.once("close", code => code === 0 ? done() : reject(new Error(`UseGPT ${service} could not stop.`)));
    });
  }
  return diagnoseUseGpt(environment);
}
