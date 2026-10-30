#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, chmod, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { homedir, platform, arch } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const root = new URL("..", import.meta.url).pathname;
const cache = join(homedir(), ".cache", "arkspace", "usegpt-secure-mcp");
const stateFile = join(cache, "task.json");
const probe = join(root, "dist", "usegpt", "secure-mcp-probe.js");
const mode = process.argv[2] ?? "run";
const apiKey = process.env.CONTROL_PLANE_API_KEY;
const tunnelId = process.env.CONTROL_PLANE_TUNNEL_ID;

async function json(url) { const response = await fetch(url, { headers: { "user-agent": "ArkSpace-UseGPT-probe" } }); if (!response.ok) throw new Error(`Tunnel client release lookup failed (${response.status}).`); return response.json(); }
function assetPattern() {
  const os = platform() === "darwin" ? "darwin" : platform() === "win32" ? "windows" : "linux";
  const cpu = arch() === "arm64" ? "arm64" : arch() === "x64" ? "amd64" : arch();
  return new RegExp(`${os}.*${cpu}|${cpu}.*${os}`, "i");
}
async function download(url, destination) {
  const response = await fetch(url, { headers: { "user-agent": "ArkSpace-UseGPT-probe" } });
  if (!response.ok || !response.body) throw new Error("Official tunnel-client download failed.");
  await pipeline(response.body, createWriteStream(destination));
}
const candidateClients = [
  join(process.cwd(), "reference", "tunnel-client", "tunnel-client-runtime"),
  join(root, "..", "reference", "tunnel-client", "tunnel-client-runtime"),
];
const suppliedClient = process.env.USEGPT_TUNNEL_CLIENT;
async function tunnelClient() {
  if (suppliedClient) { await chmod(suppliedClient, 0o755); return suppliedClient; }
  for (const candidate of candidateClients) { try { await chmod(candidate, 0o755); return candidate; } catch {} }
  const path = join(cache, process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client");
  try { await chmod(path, 0o755); return path; } catch {}
  const release = await json("https://api.github.com/repos/openai/tunnel-client/releases/latest");
  const asset = (release.assets ?? []).find(candidate => assetPattern().test(candidate.name) && !/sha|sum|sig|checksums/i.test(candidate.name));
  if (!asset) throw new Error("No compatible official tunnel-client release asset was found.");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const archive = join(cache, asset.name);
  await download(asset.browser_download_url, archive);
  if (asset.digest?.startsWith("sha256:")) {
    const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
    if (digest !== asset.digest.slice("sha256:".length)) throw new Error("Official tunnel-client checksum did not match.");
  }
  if (/\.zip$/i.test(archive)) {
    const result = spawnSync("unzip", ["-o", archive, "-d", cache], { stdio: "ignore" }); if (result.status !== 0) throw new Error("Downloaded tunnel-client archive could not be unpacked.");
  } else if (/\.(tar\.gz|tgz)$/i.test(archive)) {
    const result = spawnSync("tar", ["-xzf", archive, "-C", cache], { stdio: "ignore" }); if (result.status !== 0) throw new Error("Downloaded tunnel-client archive could not be unpacked.");
  } else {
    const bytes = await readFile(archive);
    await writeFile(path, bytes);
  }
  const found = spawnSync("find", [cache, "-type", "f", "-name", "tunnel-client"], { encoding: "utf8" }).stdout.trim().split("\n").find(Boolean);
  if (!found) throw new Error("Downloaded tunnel-client executable was not found.");
  if (found !== path) { const bytes = await readFile(found); await writeFile(path, bytes); }
  await chmod(path, 0o755); return path;
}
function requireCredentials() {
  if (!apiKey || !tunnelId) throw new Error("Set CONTROL_PLANE_TUNNEL_ID and CONTROL_PLANE_API_KEY first.");
}
function seedTask(prompt) {
  const seed = spawnSync(process.execPath, [probe, "seed", prompt || "Return the marker exactly and briefly explain the result."], { env: { ...process.env, ARKSPACE_USEGPT_PROBE_TASK_FILE: stateFile }, encoding: "utf8" });
  if (seed.status !== 0) throw new Error(seed.stderr || "Could not create the probe task.");
  try { return JSON.parse(seed.stdout); } catch { throw new Error("Probe task creation returned invalid data."); }
}
async function startTunnel(client) {
  requireCredentials();
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const tunnel = spawn(client, ["run", "--mcp.command", `node ${probe}`, "--log.level=info", "--log.format=struct-text"], { env: { ...process.env, CONTROL_PLANE_API_KEY: apiKey, CONTROL_PLANE_TUNNEL_ID: tunnelId, ARKSPACE_USEGPT_PROBE_TASK_FILE: stateFile }, stdio: ["ignore", "inherit", "inherit"] });
  tunnel.once("exit", (code, signal) => { if (code !== 0 && signal !== "SIGTERM") process.exitCode = code ?? 1; });
  return tunnel;
}
async function waitForTerminal(tunnel) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    try { const state = JSON.parse(await readFile(stateFile, "utf8")); if (["completed", "failed"].includes(state.status)) { console.log(JSON.stringify(state)); tunnel.kill(); return; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  tunnel.kill(); throw new Error("Secure MCP feasibility probe timed out waiting for ChatGPT.");
}
async function main() {
  if (mode === "seed") { const task = seedTask(process.argv.slice(3).join(" ")); console.log(JSON.stringify({ taskId: task.taskId, marker: task.marker, status: task.status })); return; }
  requireCredentials();
  const client = await tunnelClient();
  if (mode === "host") { await startTunnel(client); console.error("Tunnel is running. Activate usegpt_probe_present in ChatGPT once, then run this command again with seed."); await new Promise(() => {}); return; }
  const task = seedTask(process.argv.slice(2).join(" ")); console.log(JSON.stringify({ taskId: task.taskId, marker: task.marker, status: task.status }));
  const tunnel = await startTunnel(client); await waitForTerminal(tunnel);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Probe failed."); process.exitCode = 1; });