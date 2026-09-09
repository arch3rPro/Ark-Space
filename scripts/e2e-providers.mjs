import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const confirmation = "I_ACCEPT_REMOTE_CHARGES_AND_PERSISTENT_RESOURCES";
if (process.env.ARKSPACE_E2E_CONFIRM !== confirmation) fail(`Set ARKSPACE_E2E_CONFIRM=${confirmation} to run credentialed, billable E2E checks.`);
for (const name of ["EXA_API_KEY", "TAVILY_API_KEY", "FIRECRAWL_API_KEY"]) if (!process.env[name]?.trim()) fail(`${name} is required; the value is never printed or persisted.`);
const webhookUrl = process.env.ARKSPACE_E2E_WEBHOOK_URL;
if (!webhookUrl || !isPublicHttps(webhookUrl)) fail("ARKSPACE_E2E_WEBHOOK_URL must be a public HTTPS test receiver for Exa Monitor.");

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const home = await mkdtemp(join(tmpdir(), "arkspace-live-e2e-"));
const requestPath = join(home, "request.json");
const executable = resolve(root, "dist", "cli", "main.js");
const cleanups = [];
const passed = [];
let currentChild;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { interrupted = true; currentChild?.kill(signal); });
try {
  await runNode([executable, "setup"]);
  for (const provider of ["exa", "tavily", "firecrawl"]) await invoke("web.search", { query: "official Node.js TypeScript documentation", provider, maxResults: 2, timeoutMs: 60_000 });
  for (const provider of ["exa", "tavily", "firecrawl"]) await invoke("web.fetch", { urls: ["https://example.com"], provider, onlyMainContent: true, maxCharacters: 5_000, timeoutMs: 60_000 });
  for (const provider of ["tavily", "firecrawl"]) await invoke("web.map", { url: "https://example.com", provider, maxResults: 5, timeoutMs: 90_000 });
  for (const provider of ["tavily", "firecrawl"]) await invoke("web.crawl", { url: "https://example.com", provider, maxPages: 1, maxDepth: 1, maxCharacters: 5_000, timeoutMs: 180_000 });
  await invoke("web.related", { url: "https://nodejs.org/en", provider: "exa", maxResults: 2, timeoutMs: 60_000 });
  await invoke("web.extract", { urls: ["https://example.com"], prompt: "Extract the page title", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false }, provider: "firecrawl", timeoutMs: 180_000 });
  await invoke("code.context", { query: "Node.js AbortSignal.any usage", provider: "exa", tokens: 1_000, timeoutMs: 60_000 });
  for (const provider of ["exa", "tavily"]) await invoke("research.run", { prompt: "Using official Node.js sources only, state what AbortSignal.any does and provide citations.", provider, depth: "concise", timeoutMs: 600_000 });

  const opened = await invoke("browser.open", { url: "https://example.com", ttlSeconds: 120, activityTtlSeconds: 60, timeoutMs: 60_000 });
  const sessionId = opened.data.sessionId;
  cleanups.push(() => invoke("browser.close", { sessionId, timeoutMs: 60_000 }, false));
  await invoke("browser.snapshot", { sessionId, interactiveOnly: true, timeoutMs: 60_000 });
  await invoke("browser.status", { sessionId, timeoutMs: 60_000 });
  await invoke("browser.close", { sessionId, timeoutMs: 60_000 }); cleanups.pop();

  const secretPath = join(home, "exa-monitor.secret");
  const exa = await invoke("monitor.create", { name: "ArkSpace release E2E", query: "ArkSpace release E2E marker", numResults: 1, period: "1h", webhookUrl, webhookSecretPath: secretPath, confirmed: true, timeoutMs: 60_000 });
  const exaMonitorId = exa.data.monitorId;
  cleanups.push(() => invoke("monitor.delete", { monitorId: exaMonitorId, confirmed: true, timeoutMs: 60_000 }, false));
  await invoke("monitor.status", { monitorId: exaMonitorId, timeoutMs: 60_000 });
  await invoke("monitor.update", { monitorId: exaMonitorId, name: "ArkSpace release E2E updated", confirmed: true, timeoutMs: 60_000 });
  await invoke("monitor.pause", { monitorId: exaMonitorId, confirmed: true, timeoutMs: 60_000 });
  await invoke("monitor.resume", { monitorId: exaMonitorId, confirmed: true, timeoutMs: 60_000 });
  await invoke("monitor.trigger", { monitorId: exaMonitorId, confirmed: true, timeoutMs: 60_000 });
  const runs = await invoke("monitor.runs", { monitorId: exaMonitorId, limit: 5, timeoutMs: 60_000 });
  if (runs.data.runs[0]?.runId) await invoke("monitor.run.get", { monitorId: exaMonitorId, runId: runs.data.runs[0].runId, timeoutMs: 60_000 });
  await invoke("monitor.delete", { monitorId: exaMonitorId, confirmed: true, timeoutMs: 60_000 }); cleanups.pop();

  const site = await invoke("monitor.site.create", { name: "ArkSpace site E2E", schedule: { type: "text", value: "weekly", timezone: "UTC" }, targets: [{ type: "scrape", urls: ["https://example.com"], onlyMainContent: true }], retentionDays: 1, judgeEnabled: false, webhookEvents: [], confirmed: true, timeoutMs: 60_000 });
  const siteMonitorId = site.data.monitorId;
  cleanups.push(() => invoke("monitor.site.delete", { monitorId: siteMonitorId, confirmed: true, timeoutMs: 60_000 }, false));
  await invoke("monitor.site.status", { monitorId: siteMonitorId, timeoutMs: 60_000 });
  await invoke("monitor.site.update", { monitorId: siteMonitorId, name: "ArkSpace site E2E updated", confirmed: true, timeoutMs: 60_000 });
  await invoke("monitor.site.pause", { monitorId: siteMonitorId, confirmed: true, timeoutMs: 60_000 });
  await invoke("monitor.site.resume", { monitorId: siteMonitorId, confirmed: true, timeoutMs: 60_000 });
  const triggered = await invoke("monitor.site.trigger", { monitorId: siteMonitorId, confirmed: true, timeoutMs: 60_000 });
  await invoke("monitor.site.checks", { monitorId: siteMonitorId, limit: 5, timeoutMs: 60_000 });
  if (triggered.data.checkId) await invoke("monitor.site.check.get", { monitorId: siteMonitorId, checkId: triggered.data.checkId, limit: 5, timeoutMs: 60_000 }, true, ["invalid-request", "not-found"]);
  await invoke("monitor.site.delete", { monitorId: siteMonitorId, confirmed: true, timeoutMs: 60_000 }); cleanups.pop();
  process.stdout.write(`Credentialed E2E passed (${passed.length} calls): ${passed.join(", ")}\n`);
} finally {
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch { process.stderr.write("A remote cleanup failed; inspect the Provider dashboard using the IDs from its audit log.\n"); }
  await rm(home, { recursive: true, force: true });
  if (interrupted) process.exitCode = 130;
}

async function invoke(capability, input, record = true, toleratedKinds = []) {
  await writeFile(requestPath, `${JSON.stringify({ protocolVersion: 1, capability, input })}\n`, { mode: 0o600 });
  const result = await runNode([executable, "invoke", capability, "--input", requestPath], 1_900_000);
  let envelope;
  try { envelope = JSON.parse(result.stdout); } catch { throw new Error(`${capability} returned non-JSON protocol output.`); }
  if (!envelope.ok && !toleratedKinds.includes(envelope.error?.kind)) throw new Error(`${capability} failed (${envelope.error?.kind ?? "unknown"}); inspect Provider dashboards before retrying any mutation.`);
  if (record) passed.push(capability);
  return envelope;
}
function runNode(args, timeout = 120_000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ARKSPACE_HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
    currentChild = child;
    let stdout = "";
    let stderr = "";
    const collect = (target) => (chunk) => { target.value += String(chunk); if (target.value.length > 50_000_000) child.kill("SIGTERM"); };
    const stdoutTarget = { value: "" }; const stderrTarget = { value: "" };
    child.stdout.on("data", collect(stdoutTarget)); child.stderr.on("data", collect(stderrTarget));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.once("error", reject);
    child.once("close", (status) => {
      clearTimeout(timer); if (currentChild === child) currentChild = undefined;
      stdout = stdoutTarget.value; stderr = stderrTarget.value;
      if (stdout.length > 50_000_000 || stderr.length > 50_000_000) return reject(new Error("arks E2E output exceeded 50 MB."));
      if (status !== 0 && !stdout.trim().startsWith("{")) return reject(new Error(`arks process failed for ${args[2] ?? args[1]} with exit ${status}.`));
      resolvePromise({ status, stdout, stderr });
    });
  });
}
function isPublicHttps(value) { try { const url = new URL(value); return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname); } catch { return false; } }
function fail(message) { process.stderr.write(`${message}\n`); process.exit(2); }
