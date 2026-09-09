import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../src/config/schema.js";
import { writeJsonAtomic } from "../src/io/json-store.js";
import { createMcpServer } from "../src/mcp/server.js";
import { CAPABILITIES } from "../src/protocol/invoke.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("MCP stdio transport", () => {
  it("registers one schema-backed tool for every Protocol capability", () => {
    const server = createMcpServer();
    for (const capability of CAPABILITIES) {
      expect(server.toolInputSchemaJson(capability.replaceAll(".", "_")), capability).toBeDefined();
    }
  });

  it("lists tools and returns a structured Protocol envelope over stdio", async () => {
    const home = await mkdtemp(join(tmpdir(), "arkspace-mcp-"));
    directories.push(home);
    await writeJsonAtomic(join(home, "config.json"), defaultConfig());
    const child = spawn(process.execPath, [resolve("dist/cli/main.js"), "mcp", "serve"], {
      cwd: resolve("."),
      env: { ...process.env, ARKSPACE_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const messages: Array<Record<string, unknown>> = [];
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) messages.push(JSON.parse(line) as Record<string, unknown>);
    });

    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "arkspace-test", version: "1" } } });
    await waitFor(messages, 1);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = await waitFor(messages, 2);
    const result = listed.result as { tools: Array<{ name: string }> };
    expect(result.tools.map((tool) => tool.name)).toContain("browser_interact");
    expect(result.tools.map((tool) => tool.name)).toContain("monitor_create");

    send(child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "monitor_list", arguments: { limit: 5 } } });
    const called = await waitFor(messages, 3);
    expect(called.result).toMatchObject({
      isError: false,
      structuredContent: { protocolVersion: 1, ok: true, capability: "monitor.list", provider: "exa", data: { monitors: [] } },
    });
    child.kill("SIGTERM");
  });

  it("cancels Provider I/O and remains responsive after an MCP cancellation notification", async () => {
    const home = await mkdtemp(join(tmpdir(), "arkspace-mcp-cancel-"));
    directories.push(home);
    const config = defaultConfig();
    config.providerOrder = ["tavily"];
    let markSubmitted: () => void = () => undefined;
    let markCancelled: () => void = () => undefined;
    const submitted = new Promise<void>((resolvePromise) => { markSubmitted = resolvePromise; });
    const cancelled = new Promise<void>((resolvePromise) => { markCancelled = resolvePromise; });
    const fixture = createServer((_request, response) => { markSubmitted(); response.once("close", markCancelled); });
    await new Promise<void>((resolvePromise) => fixture.listen(0, "127.0.0.1", resolvePromise));
    const address = fixture.address();
    if (!address || typeof address === "string") throw new Error("Could not bind MCP cancellation fixture.");
    config.providers.tavily!.baseUrl = `http://127.0.0.1:${address.port}`;
    await writeJsonAtomic(join(home, "config.json"), config);
    const child = spawn(process.execPath, [resolve("dist/cli/main.js"), "mcp", "serve"], { cwd: resolve("."), env: { ...process.env, ARKSPACE_HOME: home, TAVILY_API_KEY: "mcp-cancel-secret" }, stdio: ["pipe", "pipe", "pipe"] });
    const messages: Array<Record<string, unknown>> = [];
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { buffer += chunk; const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) if (line.trim()) messages.push(JSON.parse(line) as Record<string, unknown>); });
    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "arkspace-cancel-test", version: "1" } } });
    await waitFor(messages, 1);
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "web_search", arguments: { query: "cancel this request", provider: "tavily", timeoutMs: 60_000 } } });
    await submitted;
    send(child, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2, reason: "test" } });
    send(child, { jsonrpc: "2.0", id: 3, method: "ping", params: {} });
    await within(cancelled, 5_000, "Provider I/O was not aborted.");
    expect(await waitFor(messages, 3)).toMatchObject({ result: {} });
    child.kill("SIGTERM");
    await new Promise((resolvePromise) => child.once("close", resolvePromise));
    await new Promise<void>((resolvePromise) => fixture.close(() => resolvePromise()));
  });
});

function send(child: ReturnType<typeof spawn>, message: unknown): void {
  child.stdin!.write(`${JSON.stringify(message)}\n`);
}

async function within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitFor(messages: Array<Record<string, unknown>>, id: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const message = messages.find((candidate) => candidate.id === id);
    if (message) return message;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Timed out waiting for MCP response ${id}.`);
}
