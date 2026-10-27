#!/usr/bin/env node
import { access, chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { openSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import process from "node:process";
import { resolveArkSpacePaths } from "../config/paths.js";
import { loadUseGptHubConfig } from "./secure-config.js";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const background = process.argv.includes("--background");
const paths = resolveArkSpacePaths(process.env);
const config = await loadUseGptHubConfig(paths, process.env);
const tunnelDir = join(config.dataDir, ".tunnel");
const statePath = join(tunnelDir, "tunnel.json");
const logPath = join(tunnelDir, "tunnel.log");
const writeState = async (state: { pid: number | undefined; startedAt: string; dataDir: string; logPath: string }) => { await mkdir(tunnelDir, { recursive: true, mode: 0o700 }); await writeFile(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 }); };
const candidates = [
  process.env.USEGPT_TUNNEL_CLIENT,
  resolve(process.cwd(), "reference/tunnel-client/tunnel-client-runtime"),
  resolve(root, "../Ark-Space/reference/tunnel-client/tunnel-client-runtime"),
].filter((value): value is string => Boolean(value));
let client;
for (const candidate of candidates) { try { await access(candidate); await chmod(candidate, 0o755); client = candidate; break; } catch { continue; } }
if (!client) throw new Error("Tunnel client not found. Set USEGPT_TUNNEL_CLIENT to the official tunnel-client executable.");
await mkdir(tunnelDir, { recursive: true, mode: 0o700 });
const logFd = background ? openSync(logPath, "a", 0o600) : undefined;
const child = spawn(client, [
  "run",
  "--mcp.command", `${JSON.stringify(process.execPath)} ${JSON.stringify(resolve(root, "dist/cli/main.js"))} mcp serve`,
  "--log.level=info",
  "--log.format=struct-text",
], {
  env: { ...process.env, CONTROL_PLANE_TUNNEL_ID: config.tunnelId, CONTROL_PLANE_API_KEY: config.apiKey },
  detached: background,
  stdio: background ? ["ignore", logFd, logFd] : "inherit",
});
if (background) {
  await writeState({ pid: child.pid, startedAt: new Date().toISOString(), dataDir: config.dataDir, logPath });
  child.unref();
  child.once("exit", async () => { try { await unlink(statePath); } catch { /* The process may have removed it already. */ } });
} else {
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  child.once("exit", (code, signal) => { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
}
