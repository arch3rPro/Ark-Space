import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "arkspace-installed-hosts-"));
try {
  requireCommand("claude", ["--version"]);
  requireCommand("codex", ["--version"]);
  run(process.execPath, ["--version"]);
  run(npmCommand(), ["run", "build"]);
  const pack = JSON.parse(run(npmCommand(), ["pack", "--json", "--pack-destination", temporary]));
  const tarball = join(temporary, pack[0].filename);
  const prefix = join(temporary, "install");
  run(npmCommand(), ["install", "--ignore-scripts", "--prefix", prefix, tarball]);
  const executable = process.platform === "win32" ? join(prefix, "node_modules", ".bin", "arks.cmd") : join(prefix, "node_modules", ".bin", "arks");
  if (run(executable, ["--version"]).trim() !== "0.1.0") throw new Error("Packed arks version check failed.");

  await verifyInstalledMcp(executable);
  verifyClaude(executable);
  verifyCodex(executable);
  process.stdout.write("Installed package, Claude Code plugin/MCP, Codex MCP, cancellation, and clean exit checks passed.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function verifyInstalledMcp(executable) {
  const home = join(temporary, "arkspace-home");
  run(executable, ["setup"], { ARKSPACE_HOME: home });
  let markSubmitted;
  let markCancelled;
  const submitted = new Promise((resolvePromise) => { markSubmitted = resolvePromise; });
  const cancelled = new Promise((resolvePromise) => { markCancelled = resolvePromise; });
  const server = createServer((_request, response) => {
    markSubmitted();
    response.once("close", () => markCancelled());
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start cancellation fixture server.");
  const configPath = join(home, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.providerOrder = ["tavily"];
  config.providers.tavily.baseUrl = `http://127.0.0.1:${address.port}`;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  const child = spawn(executable, ["mcp", "serve"], { env: mergedEnv({ ARKSPACE_HOME: home, TAVILY_API_KEY: "installed-host-cancellation-key" }), stdio: ["pipe", "pipe", "pipe"] });
  const messages = []; let buffer = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { buffer += chunk; const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) if (line.trim()) messages.push(JSON.parse(line)); });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "arkspace-installed-host-test", version: "1" } } });
  await response(messages, 1);
  send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
  send(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tools = (await response(messages, 2)).result.tools.map((tool) => tool.name);
  for (const required of ["web_search", "browser_interact", "monitor_create", "monitor_site_create"]) if (!tools.includes(required)) throw new Error(`Installed MCP did not discover ${required}.`);
  send(child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "monitor_list", arguments: { limit: 1 } } });
  const call = await response(messages, 3);
  if (call.result?.structuredContent?.capability !== "monitor.list") throw new Error("Installed MCP tool call failed.");

  send(child, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "web_search", arguments: { query: "cancel this request", provider: "tavily", timeoutMs: 60_000 } } });
  await within(submitted, 5_000, "Installed MCP request was not submitted.");
  send(child, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 4, reason: "installed-host cancellation test" } });
  send(child, { jsonrpc: "2.0", id: 5, method: "ping", params: {} });
  await within(waitUntil(() => messages.some((message) => message.id === 5)), 5_000, `Installed MCP did not process traffic after tool request. stderr=${stderr}`);
  await within(cancelled, 5_000, `Installed MCP cancellation did not abort Provider I/O. stderr=${stderr}; messages=${JSON.stringify(messages)}`);
  child.kill("SIGTERM");
  await within(new Promise((resolvePromise, reject) => { child.once("error", reject); child.once("close", resolvePromise); }), 5_000, "Installed MCP did not exit after SIGTERM.");
  await new Promise((resolvePromise) => server.close(resolvePromise));
}

function verifyClaude(executable) {
  const config = join(temporary, "claude");
  run("claude", ["plugin", "validate", root], { CLAUDE_CONFIG_DIR: config });
  run("claude", ["plugin", "marketplace", "add", "./"], { CLAUDE_CONFIG_DIR: config });
  run("claude", ["plugin", "install", "arkspace@arkspace-dev", "--scope", "user"], { CLAUDE_CONFIG_DIR: config });
  const plugins = run("claude", ["plugin", "list"], { CLAUDE_CONFIG_DIR: config });
  if (!plugins.includes("arkspace@arkspace-dev") || !plugins.includes("enabled")) throw new Error("Claude Code did not discover the installed plugin.");
  run("claude", ["mcp", "add", "--scope", "user", "arkspace", "--", executable, "mcp", "serve"], { CLAUDE_CONFIG_DIR: config });
  const mcp = run("claude", ["mcp", "get", "arkspace"], { CLAUDE_CONFIG_DIR: config });
  if (!mcp.includes(executable) || !mcp.includes("Connected")) throw new Error("Claude Code did not connect to installed ArkSpace MCP.");
}
function verifyCodex(executable) {
  const home = join(temporary, "codex");
  run(process.execPath, ["-e", "require('fs').mkdirSync(process.argv[1], {recursive:true})", home]);
  run("codex", ["mcp", "add", "arkspace", "--", executable, "mcp", "serve"], { CODEX_HOME: home });
  const mcp = run("codex", ["mcp", "get", "arkspace"], { CODEX_HOME: home });
  if (!mcp.includes(executable) || !mcp.includes("enabled: true")) throw new Error("Codex did not discover installed ArkSpace MCP.");
}
function run(command, args, extraEnvironment = {}) {
  const result = spawnSync(command, args, { cwd: root, env: mergedEnv(extraEnvironment), encoding: "utf8", timeout: 120_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr || result.stdout}`);
  return result.stdout;
}
function requireCommand(command, args) { run(command, args); }
function mergedEnv(extra) { return { ...process.env, PATH: `${process.env.PATH ?? ""}${delimiter}${join(temporary, "install", "node_modules", ".bin")}`, ...extra }; }
function npmCommand() { return process.platform === "win32" ? "npm.cmd" : "npm"; }
function send(child, message) { child.stdin.write(`${JSON.stringify(message)}\n`); }
async function response(messages, id) { await within(waitUntil(() => messages.find((message) => message.id === id)), 5_000, `Timed out waiting for MCP response ${id}.`); return messages.find((message) => message.id === id); }
async function waitUntil(probe) { for (;;) { const value = probe(); if (value) return value; await new Promise((resolvePromise) => setTimeout(resolvePromise, 10)); } }
async function within(promise, timeoutMs, message) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]); } finally { clearTimeout(timer); } }
