#!/usr/bin/env node
import { chmod, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { resolveArkSpacePaths } from "../dist/config/paths.js";
import { loadUseGptHubConfig } from "../dist/usegpt/secure-config.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const paths = resolveArkSpacePaths(process.env);
const config = await loadUseGptHubConfig(paths, process.env);
const candidates = [
  process.env.USEGPT_TUNNEL_CLIENT,
  resolve(process.cwd(), "reference/tunnel-client/tunnel-client-runtime"),
  resolve(root, "../Ark-Space/reference/tunnel-client/tunnel-client-runtime"),
].filter((value) => value);
let client;
for (const candidate of candidates) {
  try { await access(candidate); await chmod(candidate, 0o755); client = candidate; break; } catch {}
}
if (!client) {
  console.error("Tunnel client not found. Set USEGPT_TUNNEL_CLIENT to the official tunnel-client executable.");
  process.exitCode = 1;
} else {
  const child = spawn(client, [
    "run",
    "--mcp.command", `${JSON.stringify(process.execPath)} ${JSON.stringify(resolve(root, "dist/cli/main.js"))} mcp serve`,
    "--log.level=info",
    "--log.format=struct-text",
  ], {
    env: { ...process.env, CONTROL_PLANE_TUNNEL_ID: config.tunnelId, CONTROL_PLANE_API_KEY: config.apiKey },
    stdio: "inherit",
  });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("exit", (code, signal) => {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
